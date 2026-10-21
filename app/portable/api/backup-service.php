<?php
declare(strict_types=1);
namespace Clinic;
require_once __DIR__.'/version.php';

/** A bounded, authenticated full logical backup. Connection credentials and live
 * authentication tokens are deliberately NOT portable. All SQL identifiers are fixed. */
final class FullBackup {
    public const TABLES=['dc_meta','dc_users','dc_patients','dc_visits','dc_receipts','dc_contacts','dc_appointments','dc_labs','dc_lab_cases','dc_lab_payments','dc_lab_allocations','dc_expenses','dc_expense_items','dc_expense_payments','dc_material_usages','dc_files','dc_operations','dc_audit','dc_import_sources'];
    public const VOLATILE=['dc_sessions','dc_password_resets','dc_login_limits'];
    private const MAGIC="CLINIC-BACKUP-1\n";
    public function __construct(public DB $db,public array $config){}
    public function limit():int{return min(67108864,max(1048576,(int)($this->config['backup']['max_plain_bytes']??16777216)),max(1048576,intdiv(self::iniBytes(ini_get('memory_limit')),8)));}
    public function schema():array{$out=[];foreach(self::TABLES as $t)$out[$t]=array_column($this->db->q('SHOW COLUMNS FROM `'.$t.'`')->fetchAll(),'Field');return $out;}
    public function policy():array{return $this->db->get('backup_policy',['recipient'=>'','weeklyRequested'=>false,'publicKey'=>'']);}
    public function state():array{return $this->db->get('backup_state',[]);}
    public function updateState(array $patch):void{$this->db->pdo->beginTransaction();try{$this->db->lock();$this->db->set('backup_state',array_merge($this->state(),$patch));$this->db->pdo->commit();}catch(\Throwable $e){if($this->db->pdo->inTransaction())$this->db->pdo->rollBack();throw $e;}}
    public function publicKey(string $key):string{$bytes=base64_decode($key,true);if($bytes===false||strlen($bytes)!==32)reject('مفتاح تشفير غير صالح.');return $bytes;}
    public function keyPair():array{if(!function_exists('sodium_crypto_box_keypair'))reject('فعّل إضافة sodium في PHP للتشفير؛ النسخ غير المشفر غير متاح.',503);$pair=sodium_crypto_box_keypair();$pub=sodium_crypto_box_publickey($pair);return ['format'=>'clinic-backup-key','version'=>1,'keyId'=>hash('sha256',$pub),'publicKey'=>base64_encode($pub),'keyPair'=>base64_encode($pair)];}
    public function savePolicy(array $value):void{
        $email=text($value['recipient']??'',254);if($email!==''&&!filter_var($email,FILTER_VALIDATE_EMAIL))reject('البريد غير صالح.');
        $public=text($value['publicKey']??'',100);if($public!=='')$this->publicKey($public);
        if($public!==($this->policy()['publicKey']??'')&&($value['keySaved']??false)!==true)reject('احفظ مفتاح فك التشفير منفصلًا أولًا.');
        $this->db->pdo->beginTransaction();try{$this->db->lock();$old=$this->policy();$new=['recipient'=>$email,'weeklyRequested'=>($value['weeklyRequested']??false)===true,'publicKey'=>$public];$this->db->set('backup_policy',$new);if($email!==($old['recipient']??'')||$public!==($old['publicKey']??''))$this->db->set('backup_state',[]);$this->db->pdo->commit();}catch(\Throwable $e){if($this->db->pdo->inTransaction())$this->db->pdo->rollBack();throw $e;}
    }
    public function fingerprint():string{return hash('sha256',json([$this->config['app_url'],$this->config['database']['host'],$this->config['database']['name'],$this->config['backup']??[]]));}
    public function status():array{
        $p=$this->policy();$s=$this->state();$b=$this->config['backup']??[];$provider=$b['hosting_profile']??'unknown';
        if(($s['sendLease']??0)>0&&$s['sendLease']<time())$s['failure']='توقفت محاولة الإرسال قبل تأكيد نتيجتها؛ راجع التخزين والبريد وحدود وقت PHP قبل إعادة النسخ.';
        $age=time()-($s['lastHeartbeat']??0);$cron=$provider==='cron';$tested=($s['binding']??'')===$this->fingerprint()&&($s['cronProbes']??0)>=2&&$age>=0&&$age<10800;
        $active=$cron&&$tested&&($p['weeklyRequested']??false)&&!empty($s['mailVerified'])&&($s['mailVerifiedBinding']??'')===$this->fingerprint()&&!empty($s['lastDelivery'])&&empty($s['failure']);
        return ['policy'=>$p,'state'=>array_diff_key($s,array_flip(['mailCodeHash','mailCodeExpires'])),'capabilities'=>['sodium'=>function_exists('sodium_crypto_box_seal'),'curl'=>function_exists('curl_init'),'smtpConfigured'=>!empty($b['smtp']['host'])&&!empty($b['smtp']['from']),'offsiteConfigured'=>!empty($b['webdav']['url']),'hostingProfile'=>$provider,'cronSupported'=>$cron,'weeklyActive'=>$active,'maxPlainBytes'=>$this->limit(),'maxUploadBytes'=>min(self::iniBytes(ini_get('post_max_size')),self::iniBytes(ini_get('upload_max_filesize')))],'scheduleMessage'=>$provider==='infinityfree'?'InfinityFree المجانية لا تدعم cron؛ النسخ الأسبوعي غير مفعل. استخدم النسخ اليدوي.':($active?'النسخ الأسبوعي مفعل بعد وصول اختبار البريد ورصد مهمتين مجدولتين؛ آخر رصد خلال ٣ ساعات.':'النسخ الأسبوعي غير مفعل أو لم يُختبر/انقطع رصد المهمة. يلزم cron كل ساعة، واختبار إرسال وتأكيد وصول البريد؛ فتح الموقع لا يشغّل الجدولة.')];
    }
    public static function iniBytes(string $raw):int{$v=(int)$raw;return $v<=0?PHP_INT_MAX:$v*(match(strtolower(substr(trim($raw),-1))){'g'=>1073741824,'m'=>1048576,'k'=>1024,default=>1});}
    public function create():array{
        if(!function_exists('sodium_crypto_box_seal'))reject('إضافة sodium مطلوبة للنسخ المشفر.',503);
        $pub=$this->publicKey($this->policy()['publicKey']??'');$data=[];$used=0;$query=null;$buffered=null;
        $this->db->pdo->beginTransaction();
        try {
            $revision=$this->db->lock();$schema=$this->schema();
            $fileBytes=(int)$this->db->one('SELECT COALESCE(SUM(byte_length),0) AS n FROM dc_files')['n'];
            if($fileBytes*4/3>$this->limit())reject('المرفقات تتجاوز حد النسخ؛ لم ننتج نسخة جزئية. راجع الحد أو استخدم SQL.',413);
            $buffered=$this->db->pdo->getAttribute(\PDO::MYSQL_ATTR_USE_BUFFERED_QUERY);
            $this->db->pdo->setAttribute(\PDO::MYSQL_ATTR_USE_BUFFERED_QUERY,false);
            foreach(self::TABLES as $table) {
                $rows=[];$query=$this->db->q('SELECT * FROM `'.$table.'`');
                while($row=$query->fetch()) {
                    if($table==='dc_meta'&&str_starts_with($row['id'],'backup_'))continue;
                    if($table==='dc_files')$row['content']=base64_encode($row['content']);
                    $used+=strlen(json($row));
                    if($used>$this->limit()||count($rows)>=20000)reject('تجاوزت البيانات حد النسخ الآمن؛ لم ننتج نسخة ناقصة. راجع الحد أو استخدم SQL.',413);
                    $rows[]=$row;
                }
                $query->closeCursor();$data[$table]=$rows;
            }
            $this->db->pdo->commit();
        } catch(\Throwable $e) {
            $query?->closeCursor();if($this->db->pdo->inTransaction())$this->db->pdo->rollBack();throw $e;
        } finally {
            if($buffered!==null)$this->db->pdo->setAttribute(\PDO::MYSQL_ATTR_USE_BUFFERED_QUERY,$buffered);
        }
        $manifest=['format'=>'clinic-full-backup','formatVersion'=>BACKUP_FORMAT,'systemVersion'=>SYSTEM_VERSION,'schemaVersion'=>1,'createdAt'=>now(),'backupId'=>uuid(),'revision'=>$revision,'keyId'=>hash('sha256',$pub),'counts'=>array_map('count',$data),'totals'=>$this->totals($data)];
        foreach($data as $rows)if(count($rows)>20000)reject('عدد سجلات جدول يتجاوز حد الاستعادة الآمن؛ استخدم SQL أو راجع حد الإصدار. لم ننتج نسخة ناقصة.',413);
        $plain=json(['manifest'=>$manifest,'schema'=>$schema,'data'=>$data]);if(strlen($plain)>$this->limit())reject('حجم القاعدة يتجاوز حد النسخ المضبوط؛ لم تُنتج نسخة ناقصة. ارفع الحد وفق ذاكرة الخادم أو استخدم SQL من phpMyAdmin.',413);
        $packed=gzencode($plain,6);$bytes=self::MAGIC.sodium_crypto_box_seal($packed,$pub);sodium_memzero($plain);
        return ['bytes'=>$bytes,'manifest'=>$manifest,'sha256'=>hash('sha256',$bytes),'filename'=>'clinic-'.$manifest['backupId'].'.clinicbackup'];
    }
    public function open(string $bytes,string $keyFile):array{
        if(!function_exists('sodium_crypto_box_seal_open'))reject('إضافة sodium مطلوبة لفك النسخة.',503);
        if(strlen($bytes)>$this->limit()+1048576||!str_starts_with($bytes,self::MAGIC))reject('الملف غير صالح أو حجمه أكبر من الحد.',413);
        try{$key=decode($keyFile);}catch(\Throwable){reject('ملف مفتاح غير صالح.');}$pair=base64_decode($key['keyPair']??'',true);
        if(($key['format']??'')!=='clinic-backup-key'||($key['version']??0)!==1||$pair===false||strlen($pair)!==64)reject('ملف مفتاح غير صالح.');
        $packed=sodium_crypto_box_seal_open(substr($bytes,strlen(self::MAGIC)),$pair);sodium_memzero($pair);if($packed===false)reject('فشل التحقق من سلامة النسخة أو مفتاح فك التشفير غير مطابق.');
        $plain=@gzdecode($packed,$this->limit());if($plain===false)reject('محتوى النسخة تالف أو يتجاوز حد الذاكرة المضبوط.');
        try{$bundle=decode($plain);}catch(\Throwable){reject('محتوى النسخة غير صالح.');}sodium_memzero($plain);$this->validate($bundle);return $bundle;
    }
    public function validate(array $v):void{
        $m=$v['manifest']??[];if(($m['format']??'')!=='clinic-full-backup'||($m['formatVersion']??0)!==BACKUP_FORMAT||($m['systemVersion']??'')!==SYSTEM_VERSION||($m['schemaVersion']??0)!==1)reject('إصدار النسخة غير متوافق؛ استخدم إصدار النظام المطابق قبل الاستعادة.');
        $schema=$this->schema();if(($v['schema']??null)!==$schema||array_keys($v['data']??[])!==self::TABLES)reject('مخطط الجداول غير متوافق.');
        foreach($v['data'] as $table=>$rows){if(!is_array($rows)||count($rows)>20000||count($rows)!==($m['counts'][$table]??-1))reject('عدد سجلات غير صالح.');foreach($rows as $row){if(!is_array($row)||array_keys($row)!==$schema[$table])reject('حقول جدول غير صالحة.');foreach($row as $cell)if($cell!==null&&!is_scalar($cell))reject('نوع حقل غير صالح.');if($table==='dc_files'){$file=base64_decode($row['content'],true);if($file===false||strlen($file)!==(int)$row['byte_length']||!hash_equals($row['sha256'],hash('sha256',$file)))reject('مرفق مفقود أو تالف.');}}}
        $admins=array_filter($v['data']['dc_users'],function($r){$u=decode($r['profile_json']);return owner($u)&&(bool)$r['is_active']&&preg_match('/^\$2[ayb]\$(1[0-4])\$/',$r['password_hash']??'');});if(!$admins)reject('لا تحتوي النسخة حساب مدير فعالًا بكلمة سر آمنة.');
        if($this->totals($v['data'])!==$m['totals'])reject('ملخص الأرصدة لا يطابق السجلات.');
    }
    public function totals(array $data):array{$sum=fn($t,$c)=>array_sum(array_map(fn($r)=>(int)$r[$c],$data[$t]??[]));return ['visitsCents'=>$sum('dc_visits','total_cents'),'receiptsCents'=>$sum('dc_receipts','amount_cents'),'historicalPaidCents'=>$sum('dc_visits','historical_paid_cents'),'labCostsCents'=>$sum('dc_lab_cases','total_cost_cents'),'labPaidCents'=>$sum('dc_lab_payments','amount_cents'),'expensesCents'=>$sum('dc_expenses','total_cents'),'expensePaidCents'=>$sum('dc_expenses','paid_cents'),'inventoryCostCents'=>$sum('dc_material_usages','cost_cents')];}
    public function counts():array{$out=[];foreach(self::TABLES as $t)$out[$t]=(int)$this->db->one('SELECT COUNT(*) AS n FROM `'.$t.'`')['n'];return $out;}
    public function preview(array $bundle,string $sha,string $user):array{$claims=['sha'=>$sha,'revision'=>(int)$this->db->get('revision',0),'user'=>$user,'target'=>$this->fingerprint(),'expires'=>time()+600];$encoded=base64_encode(json($claims));return ['manifest'=>$bundle['manifest'],'currentCounts'=>$this->counts(),'targetDatabase'=>$this->config['database']['name'],'token'=>$encoded.'.'.hash_hmac('sha256',$encoded,$this->config['app_key'])];}
    public function restore(array $bundle,string $sha,string $user,string $token,string $confirmation):void{
        if($confirmation!=='استبدال البيانات')reject('اكتب عبارة التأكيد حرفيًا.');$parts=explode('.',$token);if(count($parts)!==2||!hash_equals(hash_hmac('sha256',$parts[0],$this->config['app_key']),$parts[1]))reject('أعد معاينة النسخة قبل الاستعادة.');$claims=decode(base64_decode($parts[0],true)?:'{}');if(($claims['expires']??0)<time()||($claims['user']??'')!==$user||($claims['sha']??'')!==$sha||($claims['target']??'')!==$this->fingerprint())reject('انتهت المعاينة أو تغير ملفها/وجهتها؛ أعد المعاينة.',409);
        $this->validate($bundle);$this->db->pdo->beginTransaction();try{$revision=$this->db->lock();if($revision!==$claims['revision'])reject('تغيرت بيانات الوجهة؛ أعد المعاينة والتأكيد.',409);
            $counts=$this->counts();$populated=array_sum(array_intersect_key($counts,array_flip(['dc_patients','dc_contacts','dc_appointments','dc_expenses','dc_labs','dc_files'])))>0;
            if($populated&&($this->state()['lastManualRevision']??-1)!==$revision)reject('نزّل نسخة كاملة حديثة من بيانات الوجهة قبل استبدالها.',409);
            $policy=$this->policy();foreach(self::VOLATILE as $t)$this->db->q('DELETE FROM `'.$t.'`');foreach(array_reverse(self::TABLES) as $t)$this->db->q('DELETE FROM `'.$t.'`');
            foreach(self::TABLES as $t){$cols=$bundle['schema'][$t];$sql='INSERT INTO `'.$t.'` (`'.implode('`,`',$cols).'`) VALUES ('.implode(',',array_fill(0,count($cols),'?')).')';foreach($bundle['data'][$t] as $r){if($t==='dc_meta'&&str_starts_with($r['id'],'backup_'))continue;if($t==='dc_files')$r['content']=base64_decode($r['content'],true);$this->db->q($sql,array_values($r));}}
            $this->db->set('installation',true);$this->db->set('revision',max($revision,(int)$bundle['manifest']['revision'])+1);$this->db->set('backup_policy',$policy);$this->db->set('backup_state',['lastRestore'=>now(),'restoredBackupId'=>$bundle['manifest']['backupId']]);$this->db->pdo->commit();
        }catch(\Throwable $e){if($this->db->pdo->inTransaction())$this->db->pdo->rollBack();throw $e;}
    }
}
