<?php
declare(strict_types=1);
namespace Clinic;
require_once __DIR__.'/version.php';

/** Signed, bounded releases; no PHP/SQL from an unverified archive is executed.
 * The immutable update.php dispatcher loads a private copy of this engine while
 * a job is active, so even a broken new core/auth can be rolled back. */
final class SystemUpdate {
    public const PROTOCOL=1;
    private const TABLES=[...FullBackup::TABLES,...FullBackup::VOLATILE];
    private const TERMINAL=['completed','rolled_back','cancelled'];
    private string $directory;
    public function __construct(public DB $db,public array $config,public string $publicRoot,public string $privateRoot) {
        $this->directory=$privateRoot.'/system-updates';
    }
    public function root():string{return $this->directory;}
    private function inside(string $child,string $parent):bool {
        $c=str_replace('\\','/',strtolower($child));$p=rtrim(str_replace('\\','/',strtolower($parent)),'/');return $c===$p||str_starts_with($c,$p.'/');
    }
    public function capabilities():array {
        $reasons=[];
        if(PHP_VERSION_ID<80200)$reasons[]='يلزم PHP 8.2 أو أحدث.';
        if(!class_exists('ZipArchive'))$reasons[]='إضافة PHP ZipArchive غير متاحة.';
        if(!function_exists('sodium_crypto_sign_verify_detached'))$reasons[]='إضافة sodium غير متاحة للتحقق والتشفير.';
        if(!is_dir($this->privateRoot)||is_link($this->privateRoot)||$this->inside(realpath($this->privateRoot)?:$this->privateRoot,realpath($this->publicRoot)?:$this->publicRoot)||!is_writable($this->privateRoot))$reasons[]='يلزم مجلد خاص قابل للكتابة خارج htdocs.';
        if(!is_writable($this->publicRoot)||!is_writable($this->publicRoot.'/api')||!is_file($this->publicRoot.'/release.json'))$reasons[]='ملفات التطبيق غير قابلة للتحديث أو بيان الإصدار مفقود.';
        if(($this->config['updates']['enabled']??true)!==true)$reasons[]='التحديث الداخلي معطّل في إعدادات الاستضافة.';
        if(!is_file(__DIR__.'/update-trust.json'))$reasons[]='مفتاح ناشر التحديثات غير موجود.';
        if(ini_get('opcache.enable')&&PHP_SAPI!=='cli'&&!function_exists('opcache_invalidate'))$reasons[]='OPcache مفعل ولا يسمح بإبطال الملفات؛ يلزم تحديث يدوي وإعادة تشغيل PHP.';
        $free=@disk_free_space($this->privateRoot);if($free!==false&&$free<16777216)$reasons[]='المساحة الحرة أقل من الحد الآمن.';
        return ['supported'=>!$reasons,'reasons'=>$reasons,'maxZipBytes'=>$this->zipLimit(),'maxUploadBytes'=>min(FullBackup::iniBytes(ini_get('post_max_size')),FullBackup::iniBytes(ini_get('upload_max_filesize'))),'php'=>PHP_MAJOR_VERSION.'.'.PHP_MINOR_VERSION,'protocol'=>self::PROTOCOL,'hosting'=>'لم تُحدد الاستضافة بعد؛ هذا فحص إمكانيات الخادم الحالي فقط.','manual'=>'نزّل نسخة كاملة، فعّل الصيانة، ارفع ملفات htdocs المفكوكة من حزمة نشر موثوقة مع الاحتفاظ بملف الاتصال الخاص، ثم نفّذ ترحيل الإصدار المرفق إن وُجد. لا تُعد تشغيل المُثبّت ولا تستورد schema.sql فوق قاعدة قائمة.'];
    }
    public function zipLimit():int{return min(16777216,max(1048576,(int)($this->config['updates']['max_zip_bytes']??8388608)));}
    private function ensure(bool $fullCheck):void {
        if($fullCheck){$cap=$this->capabilities();if(!$cap['supported'])reject(implode(' ',$cap['reasons']).' استخدم دليل التحديث اليدوي.',503);}
        if(!is_dir($this->privateRoot)||is_link($this->privateRoot)||$this->inside(realpath($this->privateRoot)?:$this->privateRoot,realpath($this->publicRoot)?:$this->publicRoot))reject('مساحة التحديث الخاصة غير آمنة.',503);
        if(!is_dir($this->directory)&&!mkdir($this->directory,0700,true))reject('تعذر إنشاء مساحة التحديث الخاصة.',503);
        if(is_link($this->directory)||!is_writable($this->directory))reject('مساحة تحديث غير آمنة.',503);
    }
    private function atomic(string $path,string $bytes):void {
        $tmp=$path.'.'.bin2hex(random_bytes(6)).'.tmp';
        if(file_put_contents($tmp,$bytes,LOCK_EX)!==strlen($bytes)){@unlink($tmp);throw new \RuntimeException('Private write failed');}
        @chmod($tmp,0600);if(!rename($tmp,$path)){@unlink($tmp);throw new \RuntimeException('Atomic replacement failed');}
    }
    private function readJson(string $path):array {if(!is_file($path))return [];return decode(file_get_contents($path));}
    private function active():?array {$p=$this->readJson($this->directory.'/active.json');return isset($p['job'])?$this->job($p['job']):null;}
    private function job(string $id):array {if(!preg_match('/^[a-f0-9]{32}$/D',$id))reject('محاولة تحديث غير صالحة.');$j=$this->readJson($this->directory.'/'.$id.'/job.json');if(!$j)reject('محاولة التحديث غير موجودة.',404);return $j;}
    private function save(array &$job):void {$job['updatedAt']=now();$this->atomic($this->directory.'/'.$job['id'].'/job.json',json($job));}
    private function locked(callable $callback,bool $fullCheck=false):mixed {
        $this->ensure($fullCheck);$handle=fopen($this->directory.'/update.lock','c');if(!$handle)reject('تعذر فتح قفل التحديث الخاص؛ راجع صلاحيات الاستضافة أو استخدم التحديث اليدوي.',503);if(!flock($handle,LOCK_EX|LOCK_NB)){fclose($handle);reject('هناك خطوة تحديث أخرى قيد التنفيذ؛ انتظر نتيجتها.',409);}
        $name='clinic-update:'.substr(hash('sha256',$this->config['database']['name']),0,40);$sqlLock=false;
        try{$row=$this->db->one('SELECT GET_LOCK(?,0) AS acquired',[$name]);$sqlLock=(int)($row['acquired']??0)===1;if(!$sqlLock)reject('توجد عملية تحديث أخرى على قاعدة العيادة.',409);return $callback();}finally{if($sqlLock)$this->db->one('SELECT RELEASE_LOCK(?) AS released',[$name]);flock($handle,LOCK_UN);fclose($handle);}
    }
    public function status():array {
        $job=$this->active()??$this->readJson($this->directory.'/last.json');
        return ['version'=>$this->version(),'capabilities'=>$this->capabilities(),'job'=>$job?$this->summary($job):null,'maintenance'=>(bool)$this->db->get('update_maintenance',false)];
    }
    private function version():string {$r=$this->readJson($this->publicRoot.'/release.json');return $r['version']??SYSTEM_VERSION;}
    private function summary(array $j):array {$s=array_intersect_key($j,array_flip(['id','actor','state','from','to','createdAt','updatedAt','filesDone','filesTotal','migrationDone','migrationsTotal','message','error','backupReady','manifestSha','notes','progress']));if($j['state']==='health')$s['healthQuery']='action=update-health&job='.$j['id'].'&token='.hash_hmac('sha256','update-health:'.$j['id'],$this->config['app_key']);return $s;}
    private function safePath(string $p):void {
        if(strlen($p)>220||!preg_match('~^(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+$~D',$p)||preg_match('~(?:^|/)\.{1,2}(?:/|$)~',$p)||preg_match('~(?:^|/)(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|/|$)~i',$p))reject('مسار غير آمن داخل الحزمة.');
        if(!preg_match('~^(?:assets/[A-Za-z0-9_.-]+\.(?:js|css|woff2?|ttf|svg|png|webp)|api/(?:vendor/phpmailer/)?[A-Za-z0-9_.-]+\.(?:php|json)|api/(?:vendor/(?:phpmailer/)?)?\.htaccess|api/vendor/phpmailer/LICENSE|(?:index|install|reset)\.html|setup\.(?:js|css)|release\.json|\.htaccess)$~D',$p))reject('ملف خارج قائمة ملفات التطبيق المسموحة.');
        if($p==='api/update.php')reject('موزع الاستعادة الثابت لا يُستبدل من داخل الموقع؛ راجع التحديث اليدوي.');
    }
    private function destination(string $p):string {
        $this->safePath($p);$parts=explode('/',$p);$at=$this->publicRoot;
        foreach($parts as $part){$at.='/'.$part;if(is_link($at))reject('ملف أو مجلد رمزي غير مسموح في مسار التحديث.');}
        if(file_exists($at)&&!is_file($at))reject('مسار تحديث ليس ملفًا.');return $at;
    }
    /** Validate all central entries before reading any payload. No extractTo(). */
    public function inspect(string $archive):array {
        if(filesize($archive)>$this->zipLimit())reject('حزمة التحديث تتجاوز الحد.',413);
        $zip=new \ZipArchive();if($zip->open($archive,\ZipArchive::RDONLY)!==true)reject('ملف ZIP تالف أو غير صالح.');
        try {
            if($zip->numFiles<3||$zip->numFiles>1800)reject('عدد ملفات الحزمة غير صالح.');$entries=[];$total=0;
            for($i=0;$i<$zip->numFiles;$i++){
                $s=$zip->statIndex($i);$name=$s['name'];$fold=strtolower($name);
                if(isset($entries[$fold])||!preg_match('~^(?:manifest\.json|signature\.txt|payload/[A-Za-z0-9_./-]+)$~D',$name)||str_contains($name,'..')||($s['encryption_method']??0)!==0)reject('ZIP يحتوي مسارات أو ملفات مكررة/مشفرة غير مسموحة.');
                $ops=0;$attr=0;if($zip->getExternalAttributesIndex($i,$ops,$attr)&&(($attr>>16)&0170000)===0120000)reject('الروابط الرمزية ممنوعة في الحزم.');
                if($s['size']>12582912||($s['comp_size']>0&&$s['size']/$s['comp_size']>250))reject('نسبة ضغط أو حجم ملف غير آمن.',413);$total+=$s['size'];if($total>33554432)reject('حجم المحتوى أكبر من الحد.',413);$entries[$fold]=$name;
            }
            $raw=$zip->getFromName('manifest.json');$signature=$zip->getFromName('signature.txt');
            if($raw===false||strlen($raw)>262144||$signature===false||strlen($signature)>128)reject('بيان أو توقيع الحزمة مفقود.');
            $sig=base64_decode(trim($signature),true);$trust=$this->readJson(__DIR__.'/update-trust.json');$valid=false;
            foreach($trust['keys']??[] as $public){$key=base64_decode($public,true);if($key!==false&&strlen($key)===32&&$sig!==false&&strlen($sig)===64&&sodium_crypto_sign_verify_detached($sig,$raw,$key))$valid=true;}
            if(!$valid)reject('توقيع التحديث غير موثوق؛ لم تُشغّل أو تُنسخ أي ملفات.',403);
            $m=decode($raw);if(($m['format']??'')!=='clinic-app-update'||($m['protocol']??0)!==self::PROTOCOL||($m['app']??'')!=='dental-clinic-php-mysql')reject('هذه ليست حزمة تحديث متوافقة للتطبيق.');
            if(!in_array($this->version(),$m['from']??[],true)||!preg_match('/^php-mysql-[A-Za-z0-9_.-]{1,70}$/D',$m['to']??'')||$m['to']===$this->version())reject('إصدار البداية غير مطابق أو التحديث مثبت بالفعل.');
            if(($m['schemaVersion']??0)!==1||version_compare(PHP_VERSION,$m['minPhp']??'99','<'))reject('إصدار PHP أو مخطط القاعدة غير متوافق؛ يلزم تحديث يدوي مدروس.');
            if(!is_array($m['files']??null)||!count($m['files'])||count($m['files'])>1700||$zip->numFiles!==count($m['files'])+2)reject('قائمة ملفات الحزمة غير مكتملة.');$seen=[];$payload=[];
            foreach($m['files'] as $f){$p=$f['path']??'';$this->safePath($p);$fold=strtolower($p);if(isset($seen[$fold])||!isset($entries[strtolower('payload/'.$p)]))reject('ملف مكرر أو ناقص.');$seen[$fold]=true;
                $bytes=$zip->getFromName('payload/'.$p);if($bytes===false||strlen($bytes)!==($f['bytes']??-1)||!hash_equals($f['sha256']??'',hash('sha256',$bytes)))reject('بصمة ملف تحديث غير مطابقة.');
                if(str_ends_with($p,'.php'))try{token_get_all($bytes,TOKEN_PARSE);}catch(\ParseError){reject('خطأ PHP في الحزمة؛ لم يبدأ التحديث.');}
                $payload[$p]=$bytes;
            }
            if(!isset($payload['release.json'],$payload['api/version.php']))reject('بيانات إصدار التحديث ناقصة.');
            if((decode($payload['release.json'])['version']??'')!==$m['to']||!str_contains($payload['api/version.php'],"SYSTEM_VERSION='".$m['to']."'"))reject('الإصدار الداخلي لا يطابق البيان.');
            $this->validateMigrations($m['migrations']??[]);
            return ['manifest'=>$m,'manifestSha'=>hash('sha256',$raw),'files'=>$payload];
        }finally{$zip->close();}
    }
    private function validateMigrations(array $migrations):void {
        if(count($migrations)>16)reject('ترحيلات أكثر من الحد.');$seen=[];
        foreach($migrations as $m){$id=$m['id']??'';if(!preg_match('/^[a-z0-9-]{1,80}$/D',$id)||isset($seen[$id]))reject('معرّف ترحيل غير صالح.');$seen[$id]=true;
            if(($m['kind']??'')==='meta-default'){if(!preg_match('/^system_migration\.[a-z0-9_.-]{1,80}$/D',$m['key']??'')||strlen(json($m['value']??null))>16384)reject('ترحيل إعداد غير مسموح.');}
            elseif(($m['kind']??'')==='add-nullable-column'){if(!in_array($m['table']??'',FullBackup::TABLES,true)||!preg_match('/^[a-z][a-z0-9_]{0,47}$/D',$m['column']??'')||!in_array($m['type']??'',['VARCHAR(191)','TEXT','BIGINT','INT','DATETIME(3)'],true))reject('ترحيل عمود غير مسموح.');}
            else reject('نوع ترحيل غير مدعوم بأمان داخل الموقع؛ استخدم مسار التحديث اليدوي.');
        }
    }
    public function prepare(string $archive,string $actor):array {
        return $this->locked(function()use($archive,$actor){$cap=$this->capabilities();if(!$cap['supported'])reject(implode(' ',$cap['reasons']).' استخدم التحديث اليدوي.',503);if($this->active()||$this->db->get('update_maintenance'))reject('توجد محاولة تحديث لم تُغلق؛ تابعها أو استعد النسخة أولًا.',409);
            $bundle=$this->inspect($archive);$id=bin2hex(random_bytes(16));$dir=$this->directory.'/'.$id;if(!mkdir($dir,0700))reject('تعذر تجهيز مساحة التحديث.',503);
            mkdir($dir.'/engine',0700);mkdir($dir.'/payload',0700);mkdir($dir.'/before',0700);
            foreach(['core','auth','backup-service','version','update-service'] as $file)copy(__DIR__.'/'.$file.'.php',$dir.'/engine/'.$file.'.php');copy(__DIR__.'/update-trust.json',$dir.'/engine/update-trust.json');
            $before=[];$size=0;
            foreach($bundle['files'] as $p=>$bytes){$target=$this->destination($p);$parent=dirname($target);while(!is_dir($parent))$parent=dirname($parent);if(!is_writable($parent)||(is_file($target)&&!is_writable($target)))reject('لا يمكن استبدال بعض ملفات التطبيق؛ استخدم التحديث اليدوي.',503);
                $size+=strlen($bytes)+(is_file($target)?filesize($target):0);$staged=$dir.'/payload/'.$p;if(!is_dir(dirname($staged)))mkdir(dirname($staged),0700,true);$this->atomic($staged,$bytes);$before[$p]=is_file($target)?hash_file('sha256',$target):null;
            }
            $free=@disk_free_space($this->directory);if($free!==false&&$free<$size*3+16777216)reject('المساحة لا تكفي للنسخة والرجوع؛ استخدم تحديثًا يدويًا.',503);
            foreach($bundle['manifest']['migrations']??[] as $m)if($m['kind']==='add-nullable-column'&&$this->columnExists($m['table'],$m['column']))reject('العمود المطلوب موجود بالفعل؛ راجع توافق الحزمة.');
            $job=['id'=>$id,'actor'=>$actor,'state'=>'prepared','from'=>$this->version(),'to'=>$bundle['manifest']['to'],'createdAt'=>now(),'filesDone'=>0,'filesTotal'=>count($bundle['files']),'migrationDone'=>0,'migrationsTotal'=>count($bundle['manifest']['migrations']??[]),'manifest'=>$bundle['manifest'],'manifestSha'=>$bundle['manifestSha'],'before'=>$before,'columns'=>[],'progress'=>5,'message'=>'تم التحقق من التوقيع والملفات. راجع الإصدار وأكّد قبل البدء.','notes'=>text($bundle['manifest']['notes']??'',2000)];
            $this->save($job);$this->atomic($this->directory.'/active.json',json(['job'=>$id]));return $this->summary($job);
        });
    }
    private function requireActor(array $job,string $actor):void {if($job['actor']!==$actor)reject('هذه المحاولة بدأت من حساب مدير آخر.',403);}
    public function start(string $id,string $actor,string $confirmation):array {
        return $this->locked(function()use($id,$actor,$confirmation){$j=$this->job($id);$this->requireActor($j,$actor);if($j['state']!=='prepared'||$confirmation!=='تحديث النظام')reject('راجع الحزمة واكتب عبارة تحديث النظام أولًا.');
            $this->db->pdo->beginTransaction();try{$this->db->lock();if($this->version()!==$j['from'])reject('تغير إصدار الملفات؛ أعد المعاينة.',409);foreach($j['before'] as $p=>$sha){$t=$this->destination($p);if(($sha===null&&file_exists($t))||($sha!==null&&(!is_file($t)||!hash_equals($sha,hash_file('sha256',$t)))))reject('تغير ملف منذ المعاينة؛ ألغ المحاولة وأعد الفحص.',409);}
                $this->db->set('update_maintenance',$id);$this->db->pdo->commit();
            }catch(\Throwable $e){if($this->db->pdo->inTransaction())$this->db->pdo->rollBack();throw $e;}
            $j['state']='backup';$j['message']='الحفظ متوقف مؤقتًا. جارٍ إنشاء نقطة رجوع مشفرة.';$j['progress']=10;$this->save($j);return $this->summary($j);
        });
    }
    private function checkpoint(array &$j):void {
        $dir=$this->directory.'/'.$j['id'];$data=[];$schema=[];$size=0;$limit=(new FullBackup($this->db,$this->config))->limit();$query=null;$buffered=$this->db->pdo->getAttribute(\PDO::MYSQL_ATTR_USE_BUFFERED_QUERY);
        $this->db->pdo->beginTransaction();try{$this->db->lock(true);
            if((int)$this->db->one('SELECT COALESCE(SUM(byte_length),0) AS n FROM dc_files')['n']*4/3>$limit)reject('المرفقات أكبر من حد الرجوع الآمن؛ استخدم التحديث اليدوي.',413);$this->db->pdo->setAttribute(\PDO::MYSQL_ATTR_USE_BUFFERED_QUERY,false);
            foreach(self::TABLES as $table){$schema[$table]=array_column($this->db->q('SHOW COLUMNS FROM `'.$table.'`')->fetchAll(),'Field');$rows=[];$query=$this->db->q('SELECT * FROM `'.$table.'` LIMIT 20001');while($row=$query->fetch()){if($table==='dc_meta'&&$row['id']==='update_maintenance')continue;if($table==='dc_files')$row['content']=base64_encode($row['content']);$size+=strlen(json($row));if($size>$limit||count($rows)>=20000)reject('حجم قاعدة البيانات يتجاوز حد الرجوع الآمن؛ أُوقف التحديث بلا تغيير. استخدم المسار اليدوي.',413);$rows[]=$row;}$query->closeCursor();$data[$table]=$rows;}
            $this->db->pdo->commit();
        }catch(\Throwable $e){$query?->closeCursor();if($this->db->pdo->inTransaction())$this->db->pdo->rollBack();throw $e;}finally{$this->db->pdo->setAttribute(\PDO::MYSQL_ATTR_USE_BUFFERED_QUERY,$buffered);}
        $nonce=random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);$key=hash_hmac('sha256','system-update-checkpoint:'.$j['id'],$this->config['app_key'],true);$plain=json(['schema'=>$schema,'data'=>$data]);if(strlen($plain)>$limit)reject('النسخة أكبر من حد الرجوع الآمن.',413);
        $this->atomic($dir.'/database.sealed',$nonce.sodium_crypto_secretbox(gzencode($plain,6),$nonce,$key));sodium_memzero($plain);$j['databaseSha']=hash_file('sha256',$dir.'/database.sealed');
        foreach($j['before'] as $p=>$sha)if($sha!==null){$old=$dir.'/before/'.$p;if(!is_dir(dirname($old)))mkdir(dirname($old),0700,true);$bytes=file_get_contents($this->destination($p));if(!hash_equals($sha,hash('sha256',$bytes)))reject('تغير ملف أثناء النسخ؛ لم يبدأ استبدال الكود.',409);$this->atomic($old,$bytes);}
        $j['backupReady']=true;$j['state']='files';$j['progress']=20;$j['message']='اكتملت نسخة الرجوع للكود والقاعدة والمرفقات. جارٍ استبدال ملفات التطبيق.';$this->save($j);
    }
    private function replace(string $target,string $bytes):void {
        if(!is_dir(dirname($target)))mkdir(dirname($target),0755,true);$this->atomic($target,$bytes);@chmod($target,0644);
        if(str_ends_with($target,'.php')&&function_exists('opcache_invalidate'))@opcache_invalidate($target,true);
    }
    private function columnExists(string $table,string $column):bool {return in_array($column,array_column($this->db->q('SHOW COLUMNS FROM `'.$table.'`')->fetchAll(),'Field'),true);}
    private function migrate(array &$j):void {
        $m=$j['manifest']['migrations'][$j['migrationDone']]??null;if(!$m){$j['state']='verify';$j['progress']=90;$j['message']='جارٍ التحقق من الإصدار والمرفقات والأرصدة قبل إنهاء الصيانة.';$this->save($j);return;}
        if($m['kind']==='add-nullable-column'){
            // MySQL DDL commits implicitly: persist inverse INTENT first. A
            // stopped request can detect and undo the column on recovery.
            $key=$m['table'].'.'.$m['column'];if(!isset($j['columns'][$key])){if($this->columnExists($m['table'],$m['column']))reject('عمود غير متوقع أثناء الترحيل.');$j['columns'][$key]=$m;$this->save($j);}
            if(!$this->columnExists($m['table'],$m['column']))$this->db->q('ALTER TABLE `'.$m['table'].'` ADD COLUMN `'.$m['column'].'` '.$m['type'].' NULL');
        }else{$this->db->pdo->beginTransaction();try{$this->db->lock(true);if($this->db->get($m['key'])===null)$this->db->set($m['key'],$m['value']??null);$this->db->pdo->commit();}catch(\Throwable $e){if($this->db->pdo->inTransaction())$this->db->pdo->rollBack();throw $e;}}
        $j['migrationDone']++;$j['progress']=80+(int)(10*$j['migrationDone']/max(1,$j['migrationsTotal']));$this->save($j);
    }
    private function openCheckpoint(array $j):array {
        $file=$this->directory.'/'.$j['id'].'/database.sealed';if(!is_file($file)||!hash_equals($j['databaseSha']??'',hash_file('sha256',$file)))throw new \RuntimeException('Recovery checkpoint unavailable');
        $bytes=file_get_contents($file);$nonce=substr($bytes,0,24);$key=hash_hmac('sha256','system-update-checkpoint:'.$j['id'],$this->config['app_key'],true);$packed=sodium_crypto_secretbox_open(substr($bytes,24),$nonce,$key);if($packed===false)throw new \RuntimeException('Recovery checkpoint authentication failed');$plain=gzdecode($packed,(new FullBackup($this->db,$this->config))->limit());if($plain===false)throw new \RuntimeException('Recovery size limit');return decode($plain);
    }
    private function unchanged(array $before):void {
        foreach($before['data'] as $table=>$rows){if($table==='dc_meta'||in_array($table,FullBackup::VOLATILE,true))continue;
            $old=array_map(fn($r)=>json($r),$rows);$new=[];$cols=$before['schema'][$table];foreach($this->db->q('SELECT `'.implode('`,`',$cols).'` FROM `'.$table.'`')->fetchAll() as $r){if($table==='dc_files'){$r['content']=base64_encode($r['content']);if(!hash_equals($r['sha256'],hash('sha256',base64_decode($r['content'],true))))throw new \RuntimeException('Attachment mismatch');}$new[]=json($r);}sort($old,SORT_STRING);sort($new,SORT_STRING);if($new!==$old)throw new \RuntimeException('Data changed unexpectedly');
        }
        // Settings, counters, backup configuration and installer closure may not
        // change as an incidental effect of a release.
        foreach($before['data']['dc_meta'] as $r)if(!str_starts_with($r['id'],'system_migration.')&&$r['id']!=='update_maintenance')if($this->db->get($r['id'])!==decode($r['value_json']))throw new \RuntimeException('Settings changed unexpectedly');
    }
    public function step(string $id,string $actor):array {
        return $this->locked(function()use($id,$actor){$j=$this->job($id);$this->requireActor($j,$actor);if(in_array($j['state'],self::TERMINAL,true))return $this->summary($j);if($j['state']==='prepared')reject('لم تُؤكد بدء التحديث.');
            if($j['state']==='finalizing'){$this->finish($j,$j['finishState'],$j['message']);return $this->summary($j);}
            try{
                if($this->db->get('update_maintenance')!==$id)throw new \RuntimeException('Maintenance ownership lost');
                if($j['state']==='backup')$this->checkpoint($j);
                elseif($j['state']==='files'){
                    foreach(array_slice($j['manifest']['files'],$j['filesDone'],8) as $f){$p=$f['path'];$bytes=file_get_contents($this->directory.'/'.$id.'/payload/'.$p);if(!hash_equals($f['sha256'],hash('sha256',$bytes)))throw new \RuntimeException('Staged file corrupt');$this->replace($this->destination($p),$bytes);$j['filesDone']++;$this->save($j);}
                    $j['progress']=20+(int)(60*$j['filesDone']/$j['filesTotal']);if($j['filesDone']===$j['filesTotal']){$j['state']='migrations';$j['message']='اكتمل نسخ الكود. جارٍ تطبيق ترحيلات قاعدة البيانات المعتمدة.';}$this->save($j);
                }elseif($j['state']==='migrations')$this->migrate($j);
                elseif($j['state']==='verify'){
                    foreach($j['manifest']['files'] as $f)if(!is_file($this->destination($f['path']))||!hash_equals($f['sha256'],hash_file('sha256',$this->destination($f['path']))))throw new \RuntimeException('Installed file mismatch');
                    if($this->version()!==$j['to'])throw new \RuntimeException('Release version mismatch');$this->unchanged($this->openCheckpoint($j));$j['state']='health';$j['progress']=95;$j['message']='اكتمل فحص الملفات والبيانات. جارٍ تشغيل فحص الخادم بالإصدار الجديد قبل فتح الحفظ.';$this->save($j);
                }elseif($j['state']==='health'){/* Browser performs a SAME-ORIGIN health probe; never fake success. */
                }elseif(in_array($j['state'],['rolling_back','recovery_required'],true))$this->rollbackJob($j);
                else reject('حالة تحديث غير معروفة.');
            }catch(\Throwable $e){if($j['state']==='finalizing')throw $e;$j['error']=$e instanceof Fault?$e->getMessage():'فشلت خطوة التحديث؛ بدأ الرجوع الآمن.';$j['state']='rolling_back';$j['message']='جارٍ استعادة نقطة الرجوع. لا تُغلق الصفحة حتى تأكيد النتيجة.';$this->save($j);try{$this->rollbackJob($j);}catch(\Throwable){if($j['state']!=='finalizing')$j['state']='recovery_required';$j['message']='لم نؤكد اكتمال الاستعادة. الحفظ ما زال متوقفًا؛ أعد الاستعادة أو استخدم أداة الإنقاذ الخاصة.';$this->save($j);}}
            return $this->summary($j);
        });
    }
    private function finish(array &$j,string $state,string $message):void {
        // The durable commit decision is written before releasing maintenance.
        // If a process stops after SQL COMMIT, resuming only finalizes; it NEVER
        // restores a stale snapshot over records added after maintenance ended.
        $j['state']='finalizing';$j['finishState']=$state;$j['progress']=99;$j['message']=$message;$this->save($j);
        $this->db->pdo->beginTransaction();try{$this->db->lock(true);$current=$this->db->get('update_maintenance');if($current&&$current!==$j['id'])reject('صيانة تخص محاولة أخرى؛ لم نغيرها.',409);$this->db->set('update_maintenance',false);$this->db->set('update_last',['id'=>$j['id'],'state'=>$state,'from'=>$j['from'],'to'=>$j['to'],'at'=>now()]);$this->db->pdo->commit();}catch(\Throwable $e){if($this->db->pdo->inTransaction())$this->db->pdo->rollBack();throw $e;}
        $j['state']=$state;$j['progress']=100;$this->save($j);
        $this->atomic($this->directory.'/last.json',json($j));if(is_file($this->directory.'/active.json'))unlink($this->directory.'/active.json');
    }
    private function rollbackJob(array &$j):void {
        if($this->db->get('update_maintenance')!==$j['id'])reject('لا نعيد نسخة قديمة بعد فتح الحفظ؛ راجع حالة المحاولة.',409);
        if($j['backupReady']??false){$bundle=$this->openCheckpoint($j);$dir=$this->directory.'/'.$j['id'];
            // Authenticate every preimage before replacing anything.
            foreach($j['before'] as $p=>$sha)if($sha!==null&&(!is_file($dir.'/before/'.$p)||!hash_equals($sha,hash_file('sha256',$dir.'/before/'.$p))))throw new \RuntimeException('Code recovery unavailable');
            foreach(array_reverse($j['columns']??[]) as $m)if($this->columnExists($m['table'],$m['column']))$this->db->q('ALTER TABLE `'.$m['table'].'` DROP COLUMN `'.$m['column'].'`');
            $this->db->pdo->beginTransaction();try{$this->db->lock(true);
                foreach(array_reverse(self::TABLES) as $t)$this->db->q('DELETE FROM `'.$t.'`');
                foreach(self::TABLES as $t){$cols=$bundle['schema'][$t];$sql='INSERT INTO `'.$t.'` (`'.implode('`,`',$cols).'`) VALUES ('.implode(',',array_fill(0,count($cols),'?')).')';foreach($bundle['data'][$t] as $r){if($t==='dc_files')$r['content']=base64_decode($r['content'],true);$this->db->q($sql,array_values($r));}}
                $this->db->set('update_maintenance',$j['id']);$this->db->pdo->commit();
            }catch(\Throwable $e){if($this->db->pdo->inTransaction())$this->db->pdo->rollBack();throw $e;}
            foreach($j['before'] as $p=>$sha){$target=$this->destination($p);if($sha===null){if(is_file($target)&&!unlink($target))throw new \RuntimeException('Cannot remove new release file');}else $this->replace($target,file_get_contents($dir.'/before/'.$p));}
            $this->unchanged($bundle);
        }
        $this->finish($j,'rolled_back','لم يكتمل التحديث. استُعيد الإصدار السابق والبيانات والمرفقات، ويمكن متابعة العمل.');
    }
    public function recover(string $id,string $actor):array {
        return $this->locked(function()use($id,$actor){$j=$this->job($id);$this->requireActor($j,$actor);if(in_array($j['state'],self::TERMINAL,true))reject('انتهت المحاولة؛ لا نعيد قاعدة قديمة فوق بيانات أحدث.',409);if($j['state']==='prepared'){$this->finish($j,'cancelled','أُلغيت الحزمة قبل التنفيذ؛ لم تتغير بيانات.');return $this->summary($j);}
            if($j['state']==='finalizing'){$this->finish($j,$j['finishState'],$j['message']);return $this->summary($j);}
            $j['state']='rolling_back';$this->save($j);try{$this->rollbackJob($j);}catch(\Throwable){if($j['state']!=='finalizing')$j['state']='recovery_required';$j['message']='تعذرت الاستعادة؛ الحفظ متوقف لحين الإنقاذ. لا تبدأ مُثبّتًا جديدًا.';$this->save($j);}return $this->summary($j);
        });
    }
    public function health(string $id,string $actor,string $proof):array {
        return $this->locked(function()use($id,$actor,$proof){$j=$this->job($id);$this->requireActor($j,$actor);if($j['state']!=='health'||$this->db->get('update_maintenance')!==$id)reject('فحص التشغيل غير متاح لهذه الحالة.',409);
            if(!hash_equals(hash_hmac('sha256','update-health-confirm:'.$id.':'.$j['to'],$this->config['app_key']),$proof)){$j['error']='فشل فحص تشغيل الإصدار الجديد؛ جارٍ الرجوع.';$j['state']='rolling_back';$this->save($j);try{$this->rollbackJob($j);}catch(\Throwable){if($j['state']!=='finalizing')$j['state']='recovery_required';$this->save($j);}}
            else{$this->unchanged($this->openCheckpoint($j));$this->finish($j,'completed','اكتمل التحديث وفحص تشغيل الخادم. البيانات والمرفقات والإعدادات محفوظة؛ حدّث الصفحة.');}return $this->summary($j);
        });
    }
}
