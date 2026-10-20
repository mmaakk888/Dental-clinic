<?php
declare(strict_types=1);
// Protocol-1 recovery dispatcher. Update ZIPs cannot replace this file.
ini_set('display_errors','0');define('CLINIC_INTERNAL',true);
header('Cache-Control: no-store');header('X-Content-Type-Options: nosniff');header('X-Frame-Options: DENY');header('Referrer-Policy: no-referrer');
$configPath=dirname(__DIR__,2).'/clinic-private/config.php';if(!is_file($configPath))$configPath=dirname(__DIR__).'/_private/config.php';
if(PHP_SAPI==='cli-server'&&getenv('CLINIC_LOCAL_CONFIG'))$configPath=getenv('CLINIC_LOCAL_CONFIG');
if(PHP_SAPI==='cli-server'&&getenv('CLINIC_TEST_MODE')==='1'&&getenv('CLINIC_TEST_CONFIG'))$configPath=getenv('CLINIC_TEST_CONFIG');
$privateRoot=dirname($configPath);$engine=__DIR__;
try {
    $activePath=$privateRoot.'/system-updates/active.json';
    if(is_file($activePath)){
        $active=json_decode(file_get_contents($activePath),true,16,JSON_THROW_ON_ERROR);$id=$active['job']??'';
        if(!preg_match('/^[a-f0-9]{32}$/D',$id))throw new RuntimeException('Invalid recovery pointer');
        $engine=$privateRoot.'/system-updates/'.$id.'/engine';
    }
    foreach(['core','auth','backup-service','update-service'] as $file)require_once $engine.'/'.$file.'.php';
    if(!is_file($configPath))Clinic\reject('ملف الاتصال الخاص غير موجود.',503);$config=require $configPath;
    $u=parse_url($config['app_url']??'');if(strlen($config['app_key']??'')<32||(($u['scheme']??'')!=='https'&&!(($config['allow_http_loopback']??false)&&in_array($u['host']??'',['127.0.0.1','localhost','::1'],true))))Clinic\reject('يلزم HTTPS وإعداد خاص صحيح.',503);
    $db=new Clinic\DB($config);$auth=new Clinic\Auth($db,$config);$update=new Clinic\SystemUpdate($db,$config,dirname(__DIR__),$privateRoot);
    if(($_SERVER['REQUEST_METHOD']??'GET')==='GET'&&isset($_GET['console'])){
        // No patient/settings data is embedded. Existing cookie + password + CSRF
        // are still checked by POST, including when the new UI cannot boot.
        header('Content-Type: text/html; charset=utf-8');header("Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        ?>
        <!doctype html><html lang="ar" dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><title>إنقاذ تحديث النظام</title>
        <link rel="stylesheet" href="update-console.css"><script src="update-console.js" defer></script>
        <main><h1>إنقاذ تحديث النظام</h1><p>صفحة مستقلة للمدير عند تعذر فتح الواجهة. لا تحذف بيانات أو تعِد تشغيل المُثبّت.</p><form id="form"><label>اسم الحساب عند الحاجة للدخول<input name="username" autocomplete="username"></label><label>كلمة سر المدير<input name="password" type="password" autocomplete="current-password" required></label><button name="command" value="login">تسجيل الدخول</button><button name="command" value="step">متابعة التحديث</button><button name="command" value="recover">استعادة النسخة السابقة</button></form><pre id="status" role="status"></pre></main>
        </html>
        <?php exit;
    }
    header('Content-Type: application/json; charset=utf-8');
    if(($_SERVER['REQUEST_METHOD']??'GET')==='GET'){$user=$auth->current();Clinic\permit($user,'system.update');echo Clinic\json(['ok'=>true,'csrf'=>$auth->csrf(),'result'=>$update->status()]);exit;}
    if(($_SERVER['REQUEST_METHOD']??'')!=='POST')Clinic\reject('طريقة غير مسموحة.',405);$auth->guardCsrf();
    if((int)($_SERVER['CONTENT_LENGTH']??0)>$update->zipLimit()+1048576||empty($_POST))Clinic\reject('حجم الطلب يتجاوز إعدادات PHP؛ لم يبدأ التحديث.',413);
    $action=Clinic\text($_POST['action']??'',32);
    if($action==='login'){$user=$auth->login(['username'=>$_POST['username']??'','password'=>$_POST['password']??'']);if(!Clinic\owner($user)){$auth->logout();Clinic\reject('صفحة الإنقاذ للمدير فقط.',403);}echo Clinic\json(['ok'=>true,'csrf'=>$auth->csrf()]);exit;}
    $user=$auth->current();Clinic\permit($user,'system.update');
    if(!in_array($action,['step','health'],true))$auth->reauthenticate($_POST['password']??'');
    $result=match($action){
        'prepare'=>(function()use($update,$user){$f=$_FILES['package']??[];if(($f['error']??-1)!==UPLOAD_ERR_OK||!is_uploaded_file($f['tmp_name']??''))Clinic\reject('ارفع حزمة تحديث ZIP سليمة ضمن حد الرفع.');return $update->prepare($f['tmp_name'],$user['id']);})(),
        'start'=>$update->start($_POST['job']??'',$user['id'],$_POST['confirmation']??''),
        'step'=>$update->step($_POST['job']??'',$user['id']),
        'health'=>$update->health($_POST['job']??'',$user['id'],$_POST['proof']??''),
        'recover'=>$update->recover($_POST['job']??'',$user['id']),
        default=>Clinic\reject('إجراء تحديث غير معروف.'),
    };
    echo Clinic\json(['ok'=>true,'csrf'=>$auth->csrf(),'result'=>$result]);
}catch(Throwable $e){header('Content-Type: application/json; charset=utf-8');http_response_code($e instanceof Clinic\Fault?$e->status:500);echo json_encode(['ok'=>false,'csrf'=>isset($auth)?$auth->csrf():'','error'=>$e instanceof Clinic\Fault?$e->getMessage():'تعذر تأكيد خطوة التحديث. افتح صفحة الإنقاذ وحدّث الحالة؛ لا تعِد التثبيت.'],JSON_UNESCAPED_UNICODE);}
