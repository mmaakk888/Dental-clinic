<?php
declare(strict_types=1);
ini_set('display_errors','0');
define('CLINIC_INTERNAL',true);
require __DIR__.'/core.php';require __DIR__.'/auth.php';require __DIR__.'/store.php';require __DIR__.'/domain.php';
use Clinic\{DB,Auth,Store,Domain,Fault};
use function Clinic\{json,decode,reject,text,uuid,now,owner,permit};
header('X-Content-Type-Options: nosniff');header('X-Frame-Options: DENY');header('Referrer-Policy: no-referrer');header('Cache-Control: no-store');header('Content-Type: application/json; charset=utf-8');
$db=null;$operationChecked=false;$operationWasCommitted=false;$writeCommitAttempted=false;
try {
    $configPath=dirname(__DIR__,2).'/clinic-private/config.php';
    if(!is_file($configPath))$configPath=dirname(__DIR__).'/_private/config.php';
    if(PHP_SAPI==='cli-server'&&getenv('CLINIC_LOCAL_CONFIG'))$configPath=getenv('CLINIC_LOCAL_CONFIG');
    if(PHP_SAPI==='cli-server'&&getenv('CLINIC_TEST_MODE')==='1'&&getenv('CLINIC_TEST_CONFIG'))$configPath=getenv('CLINIC_TEST_CONFIG');
    if(!is_file($configPath))reject('أكمل إعداد ملف الاتصال الخاص خارج ملفات الموقع.',503);
    $config=require $configPath;
    if(!is_array($config)||strlen($config['app_key']??'')<32||!filter_var($config['app_url']??'',FILTER_VALIDATE_URL))reject('إعداد الخادم غير مكتمل.',503);
    $url=parse_url($config['app_url']);$local=in_array($url['host']??'',['127.0.0.1','localhost','::1'],true);
    if(($url['scheme']??'')!=='https'&&!(($config['allow_http_loopback']??false)&&$local))reject('فعّل HTTPS أولًا.',503);
    date_default_timezone_set($config['timezone']??'Africa/Cairo');$db=new DB($config);$auth=new Auth($db,$config);$store=new Store($db);$domain=new Domain($db,$config);
    $method=$_SERVER['REQUEST_METHOD']??'GET';$action=$_GET['action']??'session';
    if($method==='GET'){
        if($action==='setup-status'){echo json(['ok'=>true,'csrf'=>$auth->csrf(),'installed'=>(bool)$db->one("SELECT id FROM dc_meta WHERE id='installation'")||(bool)$db->one('SELECT id FROM dc_users LIMIT 1')]);exit;}
        if($action==='brand-logo'){$settings=$db->get('settings',[]);$logo=$settings['clinicLogo']??'';$file=null;if(preg_match('/^api\/index\.php\?action=file&id=([A-Za-z0-9_\-:.]{1,128})$/D',$logo,$match))$file=$db->one("SELECT * FROM dc_files WHERE id=? AND owner_kind='logo' AND owner_id='clinic'",[$match[1]]);if(!$file)reject('لا يوجد شعار.',404);header('Content-Type: '.$file['mime']);echo $file['content'];exit;}
        if($action==='session'){
            $user=$auth->current(false);$settings=$db->get('settings',[]);$out=['ok'=>true,'csrf'=>$auth->csrf(),'user'=>$user,'installed'=>(bool)$db->one('SELECT id FROM dc_users LIMIT 1'),'branding'=>['clinicName'=>$settings['clinicName']??'عيادة الأسنان','clinicLogo'=>!empty($settings['clinicLogo'])?'api/index.php?action=brand-logo':null]];
            if($user){$db->pdo->beginTransaction();$revision=$db->lock();$user=$auth->current();$out['user']=$user;if(isset($_GET['since'])&&ctype_digit($_GET['since'])&&(int)$_GET['since']===$revision)$out['unchanged']=true;else $out['snapshot']=$store->snapshot($user);$db->pdo->commit();}echo json($out);exit;
        }
        $user=$auth->current();
        if($action==='file'){
            $f=$db->one('SELECT * FROM dc_files WHERE id=?',[\Clinic\id($_GET['id']??'')]);if(!$f)reject('الصورة غير موجودة.',404);if($f['owner_kind']!=='logo')permit($user,'expense.save');
            header('Content-Type: '.$f['mime']);header('Content-Length: '.$f['byte_length']);header('Content-Disposition: inline; filename="clinic-image"');echo $f['content'];exit;
        }
        if($action==='backup'){permit($user,'backup');$db->pdo->beginTransaction();$db->lock();$backup=$store->backup($auth->current());$db->pdo->commit();echo json(['ok'=>true,'backup'=>$backup]);exit;}
        if($action==='audit'){permit($user,'audit');$logs=$db->q('SELECT a.*,u.profile_json AS actor_profile FROM dc_audit a LEFT JOIN dc_users u ON u.id=a.actor_id ORDER BY a.created_at DESC,a.id DESC LIMIT 2000')->fetchAll();foreach($logs as &$log){$p=$log['actor_profile']?decode($log['actor_profile']):[];$log['actor_name']=$p['name']??'حساب سابق';$log['actor_role']=$p['role']??'';unset($log['actor_profile']);}unset($log);echo json(['ok'=>true,'logs'=>$logs,'limit'=>2000]);exit;}
        reject('المسار غير موجود.',404);
    }
    if($method!=='POST')reject('طريقة الطلب غير مسموحة.',405);
    if((int)($_SERVER['CONTENT_LENGTH']??0)>4194304)reject('الطلب أكبر من الحد الآمن؛ استخدم أداة النقل للنسخ الكبيرة.',413);
    if(!str_starts_with($_SERVER['CONTENT_TYPE']??'','application/json'))reject('نوع طلب غير صالح.',415);
    $raw=file_get_contents('php://input',false,null,0,4194305);if($raw===false||strlen($raw)>4194304)reject('طلب كبير.',413);try{$input=decode($raw);}catch(JsonException){reject('JSON غير صالح.');}if(!is_array($input))reject();\Clinic\checkTree($input);$auth->guardCsrf();$action=text($input['action']??'',64);$args=$input['args']??[];if(!is_array($args))reject();
    if($action==='install'){
        if($db->one("SELECT id FROM dc_meta WHERE id='installation'")||$db->one('SELECT id FROM dc_users LIMIT 1'))reject('اكتمل التثبيت وأُغلق نهائيًا؛ سجّل الدخول بحساب المدير.',410);
        if(strlen($config['install_token']??'')<32||!hash_equals($config['install_token'],$args['installToken']??''))reject('رمز التهيئة غير صحيح.',403);
        $db->pdo->beginTransaction();try{
            if($db->one("SELECT id FROM dc_meta WHERE id='installation'")||$db->one('SELECT id FROM dc_users LIMIT 1'))reject('التهيئة مقفولة؛ توجد حسابات بالفعل.',410);
            foreach(['dc_patients','dc_visits','dc_receipts','dc_contacts','dc_appointments','dc_labs','dc_lab_cases','dc_lab_payments','dc_expenses','dc_expense_items','dc_expense_payments','dc_material_usages','dc_files'] as $table)if($db->one('SELECT id FROM '.$table.' LIMIT 1'))reject('هذه القاعدة ليست فارغة؛ اختر قاعدة جديدة. لم نحذف أو نستبدل أي بيانات.',409);
            // Separate create-only lock row makes concurrent installers have one winner.
            $db->q("INSERT INTO dc_meta(id,value_json) VALUES ('installation','true')");if($db->get('revision')===null)$db->set('revision',0);if($db->get('lastFileNo')===null)$db->set('lastFileNo',0);
            $defaultsPath=dirname($configPath).'/defaults.json';$defaults=is_file($defaultsPath)?decode(file_get_contents($defaultsPath)):null;
            if(!is_array($defaults))reject('ملف الإعدادات الافتراضية غير موجود؛ راجع الحزمة.',503);if($db->get('settings')===null)$db->set('settings',$defaults);
            $domain->apply(['id'=>'installer','role'=>'admin','isActive'=>true],'users.save',['value'=>['username'=>$args['username']??'','name'=>$args['name']??'','newPassword'=>$args['password']??'','role'=>'admin','isActive'=>true,'permissions'=>[],'email'=>$args['email']??'']]);$db->pdo->commit();
        }catch(Throwable $e){if($db->pdo->inTransaction())$db->pdo->rollBack();throw $e;}
        echo json(['ok'=>true]);exit;
    }
    if($action==='auth.login'){$auth->login($args);$db->pdo->beginTransaction();$db->lock();$snapshot=$store->snapshot($auth->current());$db->pdo->commit();echo json(['ok'=>true,'csrf'=>$auth->csrf(),'snapshot'=>$snapshot]);exit;}
    if($action==='auth.logout'){$auth->logout();echo json(['ok'=>true,'csrf'=>$auth->csrf()]);exit;}
    if($action==='auth.reset'){$auth->reset($args);echo json(['ok'=>true]);exit;}
    if($action==='auth.remember'){$auth->remember(($args['remember']??false)===true);echo json(['ok'=>true]);exit;}
    $user=$auth->current();
    if(str_starts_with($action,'ai.')){require_once __DIR__.'/ai.php';echo json(['ok'=>true,'result'=>\Clinic\aiRequest($db,$config,$user,$action,$args)]);exit;}
    $operation=$input['operationId']??'';
    if(!is_string($operation)||!preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/D',$operation))reject('معرّف المحاولة غير صالح.');
    $db->pdo->beginTransaction();$revision=$db->lock();$user=$auth->current();$prior=$db->one('SELECT * FROM dc_operations WHERE id=?',[$operation]);$operationChecked=true;$operationWasCommitted=$prior&&$prior['action']!=='cancelled';
    if($action==='operation.cancel'){
        if($prior&&$prior['actor_id']!==$user['id'])reject('غير مصرح.',403);
        if(!$prior)$db->q('INSERT INTO dc_operations(id,actor_id,action,request_hash,result_json,created_at) VALUES (?,?,?,?,?,?)',[$operation,$user['id'],'cancelled',str_repeat('0',64),json(['cancelled'=>true]),now()]);$db->pdo->commit();$db->pdo->beginTransaction();$db->lock();$snapshot=$store->snapshot($auth->current());$db->pdo->commit();echo json(['ok'=>true,'committed'=>$prior&&$prior['action']!=='cancelled','snapshot'=>$snapshot]);exit;
    }
    $hash=hash('sha256',json(['action'=>$action,'args'=>$args,'expectedRevision'=>$input['expectedRevision']??null]));
    if($prior){if($prior['actor_id']!==$user['id']||$prior['action']==='cancelled'||!hash_equals($prior['request_hash'],$hash))reject('المحاولة محفوظة بمحتوى آخر أو ملغاة.',409);$result=decode($prior['result_json']);}
    else {
        if(($input['expectedRevision']??null)!==$revision)reject('تغيّرت البيانات على جهاز آخر؛ حدّثها وراجع المسودة.',409);
        $commandArgs=$args;if($action==='users.reset')$commandArgs['_operationId']=$operation;
        $result=$domain->apply($user,$action,$commandArgs);$db->set('revision',$revision+1);
        $db->q('INSERT INTO dc_operations(id,actor_id,action,request_hash,result_json,created_at) VALUES (?,?,?,?,?,?)',[$operation,$user['id'],$action,$hash,json($result),now()]);
        $entity=(string)($args['id']??$args['patientId']??'');$db->q('INSERT INTO dc_audit(id,actor_id,action,entity_id,created_at,details_json) VALUES (?,?,?,?,?,?)',[uuid(),$user['id'],$action,$entity,now(),json(['operationId'=>$operation])]);
    }
    $writeCommitAttempted=true;$db->pdo->commit();$db->pdo->beginTransaction();$db->lock();$snapshot=$store->snapshot($auth->current());$db->pdo->commit();if($action==='users.reset')$result=['resetUrl'=>rtrim($config['app_url'],'/').'/reset.html#'.hash_hmac('sha256','password-reset:'.$operation.':'.$result['resetUserId'],$config['app_key'])];echo json(['ok'=>true,'result'=>$result,'snapshot'=>$snapshot]);
} catch(Throwable $e) {
    $rolledBack=false;if($db?->pdo->inTransaction())try{$db->pdo->rollBack();$rolledBack=true;}catch(Throwable){}$status=$e instanceof Fault?$e->status:500;http_response_code($status);
    echo json(['ok'=>false,'kind'=>$e instanceof Fault?$e->kind:'server','safeToEdit'=>$rolledBack&&$operationChecked&&!$operationWasCommitted&&!$writeCommitAttempted,'error'=>$e instanceof Fault?$e->getMessage():'تعذر إكمال الطلب على الخادم. لم نؤكد الحفظ؛ أعد نفس المحاولة.']);
}
