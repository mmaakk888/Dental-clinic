<?php
declare(strict_types=1);
namespace Clinic;

function catalogName(mixed $value):string {
    if(!is_string($value)||preg_match('/[\p{Cc}\x{2028}\x{2029}]/u',$value))reject('اسم الفهرس يجب أن يكون نصًا في سطر واحد.');
    $name=text($value,80);if(!$name||in_array($name,['__proto__','prototype','constructor'],true))reject('اسم الفهرس غير صالح.');return $name;
}
function catalogNameKey(string $value):string {
    $value=preg_replace('/[\x{064B}-\x{065F}\x{0670}\x{06D6}-\x{06ED}\x{0640}]/u','',$value);
    return strtolower(trim(preg_replace('/\s+/u',' ',digits(strtr($value,['أ'=>'ا','إ'=>'ا','آ'=>'ا','ٱ'=>'ا','ى'=>'ي','ی'=>'ي'])))));
}
function catalogMoney(mixed $value):int|float {money($value);if($value>10000000)reject('السعر يتجاوز الحد المسموح للفهرس.');return $value;}
function validateCatalogSettings(mixed $value,array $baseline=[]):array {
    if(!is_array($value)||!is_array($value['serviceTypes']??null)||!array_is_list($value['serviceTypes'])||count($value['serviceTypes'])>300)reject('قائمة الخدمات غير صالحة.');
    $names=[];$seen=[];foreach($value['serviceTypes'] as $name){$clean=catalogName($name);$key=catalogNameKey($clean);if(!$key||isset($seen[$key]))reject('اسم خدمة فارغ أو مكرر في الفهرس.');$seen[$key]=true;$names[]=$name;}
    foreach(['تركيبات - ثابتة','تركيبات - متحركة'] as $name)if(in_array($name,$baseline['serviceTypes']??[],true)&&!in_array($name,$names,true))reject('احتفظ بنوع التركيبة المرتبط بالنظام.');
    $out=['serviceTypes'=>$names];
    foreach(['clinicalPrices','crownPrices'] as $kind){$map=$value[$kind]??[];if(!is_array($map)||count($map)>1000)reject('قائمة الأسعار غير صالحة.');$seen=[];foreach($map as $name=>$price){$key=catalogNameKey(catalogName((string)$name));if(!$key||isset($seen[$key]))reject('نوع سعر فارغ أو مكرر.');$seen[$key]=true;catalogMoney($price);}$out[$kind]=$map;}
    foreach(array_keys($baseline['crownPrices']??[]) as $key)if(!array_key_exists($key,$out['crownPrices']))reject('احتفظ بأنواع التركيبات السابقة؛ تغيير السعر يخص التسجيل الجديد فقط.');
    $out['examinationFee']=catalogMoney($value['examinationFee']??null);
    return $out;
}
function validateWhatsAppSettings(mixed $value):array {
    if(!is_array($value)||!is_array($value['templates']??null))reject('راجع إعدادات وقوالب واتساب.');
    if(!empty($value['apiKey'])||!empty($value['webhookUrl']))reject('مفاتيح الربط لا تُحفظ في المتصفح؛ الوضع اليدوي متاح فقط.');
    $templates=[];$keys=['reminderTomorrow','newAppt','postOp','accountBalance','greeting','offer','extraction','filling','rootCanal'];
    foreach($value['templates'] as $key=>$message){if(!in_array($key,$keys,true))reject('قالب رسالة غير معروف.');text($message,8000);$templates[$key]=$message;}
    $consent=$value['campaignConsent']??[];if(!is_array($consent)||count($consent)>20000)reject('قائمة موافقات الحملات غير صالحة.');
    foreach($consent as $mobile=>$state)if(phone((string)$mobile)!==(string)$mobile||!in_array($state,['allowed','declined'],true))reject('رقم أو حالة موافقة حملة غير صالح.');
    $sender=text($value['senderNumber']??'',60);if($sender&&!phone($sender))reject('رقم المرسل غير صالح.');
    $out=['templates'=>$templates,'campaignConsent'=>$consent,'senderNumber'=>$sender,'apiKey'=>'','webhookUrl'=>''];
    foreach(['autoConfirmOnAppt','autoRemind24h','autoPostOpOnAttended'] as $key){if(isset($value[$key])&&$value[$key]!==false)reject('الأتمتة غير مفعلة؛ تحتاج خدمة إرسال وجدولة حقيقية.');$out[$key]=false;}
    return $out;
}
