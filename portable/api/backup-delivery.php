<?php
declare(strict_types=1);
namespace Clinic;

final class BackupDelivery {
    public function __construct(public FullBackup $backup,private ?\Closure $remote=null,private ?\Closure $mailer=null){if(($remote||$mailer)&&PHP_SAPI!=='cli')reject('Test transports are CLI-only.',403);}
    private function webdav(string $method,string $url,string $body='',bool $anonymous=false):array{
        if($this->remote)return ($this->remote)($method,$url,$body,$anonymous);
        if(!function_exists('curl_init'))reject('فعّل curl في PHP للتخزين الخارجي.',503);
        $u=parse_url($url);$app=parse_url($this->backup->config['app_url']);
        if(($u['scheme']??'')!=='https'||empty($u['host'])||isset($u['user'])||isset($u['pass'])||isset($u['query'])||isset($u['fragment'])||strcasecmp($u['host'],$app['host']??'')===0)reject('التخزين الخارجي يحتاج رابط HTTPS خاصًا خارج خادم الموقع، بلا بيانات دخول داخل الرابط.');
        $ips=gethostbynamel($u['host']);if(!$ips)reject('تعذر التحقق من عنوان التخزين الخارجي.');foreach($ips as $ip)if(!filter_var($ip,FILTER_VALIDATE_IP,FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE))reject('عنوان تخزين غير مسموح.');
        $c=$this->backup->config['backup']['webdav']??[];$ch=curl_init($url);$out='';$max=$this->backup->limit()+1048576;
        curl_setopt_array($ch,[CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_POSTFIELDS=>$method==='PUT'?$body:null,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>45,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,CURLOPT_RESOLVE=>[$u['host'].':'.($u['port']??443).':'.$ips[0]],CURLOPT_HTTPHEADER=>['Content-Type: application/octet-stream'],CURLOPT_WRITEFUNCTION=>static function($ch,$chunk)use(&$out,$max){if(strlen($out)+strlen($chunk)>$max)return 0;$out.=$chunk;return strlen($chunk);}]);
        if(!$anonymous)curl_setopt_array($ch,[CURLOPT_HTTPAUTH=>CURLAUTH_BASIC,CURLOPT_USERPWD=>($c['username']??'').':'.($c['password']??'')]);
        $ok=curl_exec($ch);$status=curl_getinfo($ch,CURLINFO_RESPONSE_CODE);curl_close($ch);if($ok===false)reject('فشل الاتصال المشفر بمخزن النسخ الخارجي.');return [$status,$out];
    }
    public function mail(string $recipient,string $subject,string $body,?array $attachment=null):void{
        if($this->mailer){($this->mailer)($recipient,$subject,$body,$attachment);return;}
        $c=$this->backup->config['backup']['smtp']??[];
        if(empty($c['host'])||!filter_var($c['from']??'',FILTER_VALIDATE_EMAIL)||!in_array($c['encryption']??'',['tls','ssl'],true)||!in_array((int)($c['port']??0),[465,587,2525],true))reject('أكمل إعداد SMTP الآمن في ملف الاتصال الخاص.');
        require_once __DIR__.'/vendor/phpmailer/Exception.php';require_once __DIR__.'/vendor/phpmailer/SMTP.php';require_once __DIR__.'/vendor/phpmailer/PHPMailer.php';
        $m=new \PHPMailer\PHPMailer\PHPMailer(true);$m->isSMTP();$m->Host=$c['host'];$m->Port=(int)$c['port'];$m->SMTPAuth=true;$m->Username=$c['username']??'';$m->Password=$c['password']??'';$m->SMTPSecure=$c['encryption'];$m->Timeout=20;$m->SMTPDebug=0;$m->CharSet='UTF-8';$m->setFrom($c['from'],'Clinic backup');$m->addAddress($recipient);$m->Subject=$subject;$m->Body=$body;
        if($attachment)$m->addStringAttachment($attachment['bytes'],$attachment['filename'],'base64','application/octet-stream');
        try{$m->send();}catch(\Throwable){reject('فشل تسليم الرسالة لخادم SMTP؛ تحقق من الإعدادات دون إرسال كلمة السر هنا.');}
    }
    public function send(bool $test=false):array{
        $b=$this->backup;$p=$b->policy();if(!filter_var($p['recipient']??'',FILTER_VALIDATE_EMAIL))reject('احفظ بريد النسخ الاحتياطي أولًا.');$base=rtrim($b->config['backup']['webdav']['url']??'','/');if(!$base)reject('أكمل التخزين الخاص خارج الاستضافة أولًا.');
        $b->db->pdo->beginTransaction();try{$b->db->lock();if(($b->state()['sendLease']??0)>time())reject('توجد عملية نسخ وإرسال جارية؛ انتظر نتيجتها.',409);$state=$b->state();$state['sendLease']=time()+300;$b->db->set('backup_state',$state);$b->db->pdo->commit();}catch(\Throwable $e){if($b->db->pdo->inTransaction())$b->db->pdo->rollBack();throw $e;}
        try{
            $archive=$b->create();$url=$base.'/'.rawurlencode($archive['filename']);[$status]=$this->webdav('PUT',$url,$archive['bytes']);if(!in_array($status,[200,201,204],true))reject('رفض مخزن النسخ رفع الملف.');
            [$status,$read]=$this->webdav('GET',$url);if($status!==200||!hash_equals($archive['sha256'],hash('sha256',$read)))reject('فشل فحص النسخة بعد قراءتها من التخزين الخارجي.');
            [$publicStatus]=$this->webdav('GET',$url,'',true);if(!in_array($publicStatus,[401,403],true))reject('لم يثبت أن رابط التخزين خاص؛ لن يُرسل رابط عام للنسخة.');
            $code=$test?strtoupper(bin2hex(random_bytes(4))):'';
            $body="نسخة العيادة المشفرة\nالإصدار: ".SYSTEM_VERSION."\nالتاريخ: ".$archive['manifest']['createdAt']."\nSHA-256: ".$archive['sha256']."\nرابط خاص يتطلب حساب التخزين الخارجي (لا يتضمن كلمة السر):\n".$url."\nاحتفظ بمفتاح فك التشفير منفصلًا؛ لا نحتفظ به على الخادم.".($test?"\nرمز تأكيد وصول الاختبار: ".$code:'');
            $max=min(8388608,max(1024,(int)($b->config['backup']['max_attachment_bytes']??5242880)));$attached=strlen($archive['bytes'])<=$max;
            $this->mail($p['recipient'],$test?'اختبار وصول النسخ المشفر للعيادة':'نسخة احتياطية مشفرة للعيادة',$body,$attached?$archive:null);
            $patch=['lastDelivery'=>now(),'lastBackup'=>now(),'lastBackupId'=>$archive['manifest']['backupId'],'lastDeliverySha256'=>$archive['sha256'],'deliveryMode'=>$attached?'attachment-and-private-link':'private-link','failure'=>'','sendLease'=>0,'binding'=>$b->fingerprint()];
            if($test)$patch+=['mailCodeHash'=>hash('sha256',$code),'mailCodeExpires'=>time()+1800,'mailVerified'=>false,'mailTestBinding'=>$b->fingerprint()];$b->updateState($patch);return ['sent'=>true,'attached'=>$attached,'sha256'=>$archive['sha256']];
        }catch(\Throwable $e){$message=$e instanceof Fault?$e->getMessage():'فشل النسخ أو الإرسال؛ لم يُسجل نجاح.';$b->updateState(['failure'=>$message,'failureAt'=>now(),'sendLease'=>0]);try{$this->mail($p['recipient'],'فشل نسخ العيادة الاحتياطي','لم تكتمل النسخة الخارجية: '.$message);}catch(\Throwable){}throw new Fault($message,502);}
    }
    public function verifyMail(string $code):void{$s=$this->backup->state();if(($s['mailTestBinding']??'')!==$this->backup->fingerprint()||($s['mailCodeExpires']??0)<time()||!hash_equals($s['mailCodeHash']??'',hash('sha256',strtoupper(trim($code)))))reject('رمز البريد غير صحيح أو منتهي أو تغير إعداد الإرسال.');$this->backup->updateState(['mailVerified'=>true,'mailVerifiedBinding'=>$this->backup->fingerprint(),'mailCodeExpires'=>0,'mailCodeHash'=>'']);}
    public function cron():array{
        $b=$this->backup;if(($b->config['backup']['hosting_profile']??'')!=='cron')reject('الجدولة غير مدعومة أو لم يُحدد ملف الاستضافة cron.');
        $s=$b->state();$same=($s['binding']??'')===$b->fingerprint();$last=$same?($s['lastHeartbeat']??0):0;$count=$same?($s['cronProbes']??0):0;if(time()-$last>=60&&time()-$last<=10800)$count++;else if(time()-$last>10800)$count=1;
        $b->updateState(['lastHeartbeat'=>time(),'cronProbes'=>$count,'binding'=>$b->fingerprint()]);$p=$b->policy();if(!($p['weeklyRequested']??false)||empty($s['mailVerified'])||($s['mailVerifiedBinding']??'')!==$b->fingerprint()||$count<2)return ['sent'=>false,'reason'=>'waiting-for-configuration-or-probes'];
        if(!empty($s['lastDelivery'])&&time()-strtotime($s['lastDelivery'])<604800)return ['sent'=>false,'reason'=>'not-due'];return $this->send();
    }
}
