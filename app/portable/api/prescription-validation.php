<?php
declare(strict_types=1);
namespace Clinic;
function defaultPrescriptionDesign():array {
    return ['primaryColor'=>'#1a4388','accentColor'=>'#c59d5f','headerColor'=>'#165954','fontFamily'=>'Arial','fontSize'=>12,'logoPosition'=>'left','headerStyle'=>'filled','showLogo'=>true,'showWatermark'=>true,'showFileNo'=>true,'spacing'=>'comfortable','footerNote'=>''];
}
function validatePrescriptionDesign(mixed $value):array {
    if(!is_array($value))reject('تصميم الروشتة غير صالح.');$defaults=defaultPrescriptionDesign();
    if(array_diff(array_keys($value),array_keys($defaults)))reject('حقول تصميم الروشتة غير مسموحة.');
    $v=array_merge($defaults,$value);
    foreach(['primaryColor','accentColor','headerColor'] as $key)if(!is_string($v[$key])||!preg_match('/^#[0-9a-fA-F]{6}$/D',$v[$key]))reject('لون الروشتة غير صالح.');
    foreach(['fontFamily'=>['Arial','Tahoma'],'fontSize'=>[12,13,14],'logoPosition'=>['left','right'],'headerStyle'=>['filled','outline'],'spacing'=>['comfortable','compact']] as $key=>$allowed)if(!in_array($v[$key],$allowed,true))reject('خيار تصميم الروشتة غير صالح.');
    foreach(['showLogo','showWatermark','showFileNo'] as $key)if(!is_bool($v[$key]))reject('خيار ظهور الروشتة غير صالح.');
    $v['footerNote']=text($v['footerNote'],300);return $v;
}
function validatePrescriptionHeader(mixed $value):array {
    if(!is_array($value))reject('بيانات الطبيب غير صالحة.');$keys=['doctorTitle','doctorName','doctorEnglish','specialty1','specialty2','phone','address'];
    if(array_diff(array_keys($value),$keys))reject('حقول بيانات الطبيب غير مسموحة.');
    $safe=[];foreach($keys as $key)$safe[$key]=text($value[$key]??'',500);return $safe;
}
function validatePrescriptionTemplate(mixed $value):array {
    if(!is_array($value)||array_diff(array_keys($value),['header','design']))reject('قالب الروشتة غير صالح.');
    return ['header'=>validatePrescriptionHeader($value['header']??null),'design'=>validatePrescriptionDesign($value['design']??null)];
}
