<?php
declare(strict_types=1);
ini_set('display_errors','0');define('CLINIC_INTERNAL',true);
require __DIR__.'/core.php';require __DIR__.'/auth.php';require __DIR__.'/backup-service.php';require __DIR__.'/backup-delivery.php';
use Clinic\{DB,Auth,FullBackup,BackupDelivery,Fault};
use function Clinic\{json,decode,reject};
header('Content-Type: application/json; charset=utf-8');header('Cache-Control: no-store');header('X-Content-Type-Options: nosniff');header('X-Frame-Options: DENY');header('Referrer-Policy: no-referrer');$reauthenticated=false;
try{
    $path=dirname(__DIR__,2).'/clinic-private/config.php';if(!is_file($path))$path=dirname(__DIR__).'/_private/config.php';
    if(PHP_SAPI==='cli-server'&&getenv('CLINIC_LOCAL_CONFIG'))$path=getenv('CLINIC_LOCAL_CONFIG');
    if(PHP_SAPI==='cli-server'&&getenv('CLINIC_TEST_MODE')==='1'&&getenv('CLINIC_TEST_CONFIG'))$path=getenv('CLINIC_TEST_CONFIG');
    if(!is_file($path))reject('ملف الاتصال الخاص غير موجود.',503);$config=require $path;
    $u=parse_url($config['app_url']??'');if(strlen($config['app_key']??'')<32||(($u['scheme']??'')!=='https'&&!(($config['allow_http_loopback']??false)&&in_array($u['host']??'',['127.0.0.1','localhost','::1'],true))))reject('يلزم HTTPS وإعداد خاص صحيح.',503);
    $db=new DB($config);$auth=new Auth($db,$config);$user=$auth->current();Clinic\permit($user,'backup');$backup=new FullBackup($db,$config);$delivery=new BackupDelivery($backup);
    if(($_SERVER['REQUEST_METHOD']??'GET')==='GET'){echo json(['ok'=>true,'csrf'=>$auth->csrf(),'result'=>$backup->status()]);exit;}
    if(($_SERVER['REQUEST_METHOD']??'')!=='POST')reject('طريقة غير مسموحة.',405);$auth->guardCsrf();
    if((int)($_SERVER['CONTENT_LENGTH']??0)>$backup->limit()+2097152||empty($_POST))reject('حجم الطلب يتجاوز إعدادات رفع PHP؛ راجع post_max_size وupload_max_filesize. لم تُغيّر بيانات.',413);
    $action=Clinic\text($_POST['action']??'',32);$auth->reauthenticate($_POST['password']??'');$reauthenticated=true;$result=null;
    switch($action){
        case 'generate-key':$result=$backup->keyPair();break;
        case 'settings':$backup->savePolicy(decode($_POST['value']??'{}'));$result=$backup->status();break;
        case 'download':$archive=$backup->create();$backup->updateState(['lastBackup'=>Clinic\now(),'lastManualRevision'=>$archive['manifest']['revision'],'lastBackupId'=>$archive['manifest']['backupId'],'manualStatus'=>'download-prepared']);header('Content-Type: application/octet-stream');header('Content-Disposition: attachment; filename="'.$archive['filename'].'"');header('X-Backup-Sha256: '.$archive['sha256']);echo $archive['bytes'];exit;
        case 'send':$result=$delivery->send(($_POST['test']??'')==='1');break;
        case 'verify-mail':$delivery->verifyMail($_POST['code']??'');$result=$backup->status();break;
        case 'preview':case 'restore':
            $files=[];foreach(['archive','key'] as $field){$f=$_FILES[$field]??[];if(($f['error']??-1)!==UPLOAD_ERR_OK||!is_uploaded_file($f['tmp_name']??'')||($f['size']??PHP_INT_MAX)>($field==='key'?4096:$backup->limit()+1048576))reject('ملف النسخة أو المفتاح ناقص أو يتجاوز حجم الرفع.',413);$files[$field]=file_get_contents($f['tmp_name']);}
            $bundle=$backup->open($files['archive'],$files['key']);$sha=hash('sha256',$files['archive']);
            if($action==='preview')$result=$backup->preview($bundle,$sha,$user['id']);else{$backup->restore($bundle,$sha,$user['id'],$_POST['token']??'',$_POST['confirmation']??'');$result=['restored'=>true,'loginRequired'=>true];}unset($files,$bundle);break;
        default:reject('عملية نسخ غير معروفة.');
    }
    echo json(['ok'=>true,'result'=>$result]);
}catch(Throwable $e){$error=$e instanceof Fault?$e->getMessage():'تعذرت عملية النسخ؛ لم نؤكد اكتمالها. راجع الحالة قبل التكرار.';if($reauthenticated&&($action??'')==='download')try{$backup->updateState(['failure'=>$error,'failureAt'=>Clinic\now()]);}catch(Throwable){}http_response_code($e instanceof Fault?$e->status:500);echo json(['ok'=>false,'error'=>$error]);}
