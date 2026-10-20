<?php
declare(strict_types=1);
namespace Clinic;

final class Fault extends \RuntimeException {
    public function __construct(string $message, public int $status = 400,public string $kind='request') { parent::__construct($message); }
}
function reject(string $message = 'تعذر تأكيد العملية.', int $status = 400,string $kind='request'): never { throw new Fault($message, $status,$kind); }
function json(mixed $value): string { return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION); }
function decode(string $value): mixed { return json_decode($value, true, 64, JSON_THROW_ON_ERROR); }
function id(mixed $value): string {
    if (!is_string($value) || !preg_match('/^[A-Za-z0-9_\-:.]{1,128}$/D', $value)) reject('معرّف السجل غير صالح.'); return $value;
}
function text(mixed $value, int $max = 4000): string {
    if (!is_string($value) || strlen($value) > $max * 4 || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $value)) reject('نص غير صالح.');$length=preg_match_all('/./us',$value);if($length===false||$length>$max)reject('النص يتجاوز الحد المسموح.'); return trim($value);
}
function digits(string $value):string {return strtr($value,['٠'=>'0','١'=>'1','٢'=>'2','٣'=>'3','٤'=>'4','٥'=>'5','٦'=>'6','٧'=>'7','٨'=>'8','٩'=>'9','۰'=>'0','۱'=>'1','۲'=>'2','۳'=>'3','۴'=>'4','۵'=>'5','۶'=>'6','۷'=>'7','۸'=>'8','۹'=>'9']);}
function money(mixed $value): int {
    if ((!is_int($value) && !is_float($value)) || !is_finite((float)$value) || $value < 0 || $value > 10000000000 || abs($value * 100 - round($value * 100)) > 0.0001) reject('قيمة مالية غير صالحة.');
    return (int)round($value * 100);
}
function day(mixed $value): string { if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value)) reject('تاريخ غير صالح.');$date=\DateTimeImmutable::createFromFormat('!Y-m-d',$value);if(!$date||$date->format('Y-m-d')!==$value)reject('تاريخ غير صالح.'); return $value; }
function checkTree(mixed $value,int $depth=0):void {if($depth>32)reject('بنية بيانات عميقة.');if(is_array($value)){if(count($value)>20000)reject('قائمة أكبر من الحد.');foreach($value as $key=>$item){if(in_array($key,['__proto__','prototype','constructor'],true))reject('حقل غير مسموح.');checkTree($item,$depth+1);}}elseif(is_float($value)&&!is_finite($value))reject();}
function passwordHash(string $password):string {if(strlen($password)<12||strlen($password)>72)reject('كلمة السر من ١٢ إلى ٧٢ بايت؛ الحروف العربية تشغل أكثر من بايت.');return password_hash($password,PASSWORD_BCRYPT,['cost'=>12]);}
function materialKey(string $name,string $unit):string {$normalize=fn($s)=>preg_replace('/\s+/u',' ',strtr(strtolower(trim($s)),['أ'=>'ا','إ'=>'ا','آ'=>'ا','ة'=>'ه','ى'=>'ي']));return hash('sha256',$normalize($name).'|'.$normalize($unit?:'قطعة'));}
function teeth(mixed $value):array {if(!is_array($value)||count($value)>52||count(array_unique($value))!==count($value))reject('مواضع أسنان غير صالحة.');foreach($value as $tooth)if(!is_string($tooth)||!preg_match('/^(ur|ul|lr|ll)([1-8]|[A-E])$/D',$tooth))reject('موضع سن غير صالح.');return $value;}
/** Exact a*b/d without optional bcmath or an overflowing intermediate product. */
function ratio(int $a,int $b,int $divisor):array {if($a<0||$b<0||$divisor<=0)reject();$q=0;$r=0;foreach(str_split(decbin($b)) as $bit){$q*=2;$r=$r*2+($bit==='1'?$a:0);$q+=intdiv($r,$divisor);$r%=$divisor;}return [$q,$r];}
function inventoryCosts(array $items,int $total):array {$subtotal=0;foreach($items as $item)$subtotal+=money($item['total']);if(!$subtotal)return array_fill(0,count($items),0);$values=[];$remainders=[];foreach($items as $index=>$item){[$amount,$remainder]=ratio($total,money($item['total']),$subtotal);$values[$index]=$amount;$remainders[]=['index'=>$index,'remainder'=>$remainder,'id'=>$item['id']];}usort($remainders,fn($a,$b)=>$b['remainder']<=>$a['remainder']?:strcmp($a['id'],$b['id']));$remaining=$total-array_sum($values);foreach($remainders as $r){if($remaining--<=0)break;$values[$r['index']]++;}return $values;}
function uuid(): string { $b=random_bytes(16); $b[6]=chr((ord($b[6])&15)|64); $b[8]=chr((ord($b[8])&63)|128); $s=bin2hex($b); return substr($s,0,8).'-'.substr($s,8,4).'-'.substr($s,12,4).'-'.substr($s,16,4).'-'.substr($s,20); }
function now(): string { return (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z'); }
function phone(string $value): string {
    $value=strtr($value,['٠'=>'0','١'=>'1','٢'=>'2','٣'=>'3','٤'=>'4','٥'=>'5','٦'=>'6','٧'=>'7','٨'=>'8','٩'=>'9','۰'=>'0','۱'=>'1','۲'=>'2','۳'=>'3','۴'=>'4','۵'=>'5','۶'=>'6','۷'=>'7','۸'=>'8','۹'=>'9']);
    $value=trim($value);if(!preg_match('/^\+?[\d ().-]+$/D',$value))return '';$value=preg_replace('/[^0-9]/','',$value);if(str_starts_with($value,'01')&&!preg_match('/^01\d{9}$/D',$value))return '';if(str_starts_with($value,'00'))$value=substr($value,2);if(preg_match('/^01\d{9}$/D',$value))$value='2'.$value;if(!preg_match('/^[1-9]\d{7,14}$/D',$value)||(str_starts_with($value,'20')&&!preg_match('/^201\d{9}$/D',$value)))return '';return $value;
}
function owner(array $user): bool { return in_array($user['role']??'', ['doctor','admin'],true); }
function permit(array $user, string $action): void {
    if (($user['isActive']??false)!==true) reject('الحساب موقوف.',403);
    if(owner($user))return;
    $map=['patients.read'=>'patientView','patient.save'=>'patientEdit','patient.delete'=>'deletePatients','visit.save'=>'patientEdit','receipt.add'=>'registerPayment','appointment.save'=>'appointments','appointment.status'=>'appointments','prosthetic.order'=>'patientEdit','contacts.save'=>'patientEdit','contacts.delete'=>'patientEdit','rx'=>'patientView','lab.save'=>'lab','lab.delete'=>'lab','lab.legacy'=>'lab','lab.progress'=>'lab','expense.save'=>'viewExpenses','expense.delete'=>'viewExpenses','material.usage'=>'viewExpenses','material.delete'=>'viewExpenses','settings.identity'=>'controlPanel','settings.content'=>'controlPanel','settings.drugs'=>'controlPanel','settings.whatsapp'=>'controlPanel','settings.catalog'=>'managePrices','settings.routing'=>'managePrices','lab.prices'=>'managePrices','lab.payment'=>'lab'];
    $perms=$user['permissions']??[];foreach(['registerPayment'=>'patientFinance','viewExpenses'=>'summary','managePrices'=>'controlPanel'] as $key=>$fallback)if(!array_key_exists($key,$perms))$perms[$key]=$perms[$fallback]??false;
    if(($user['role']??'')!=='secretary'||!isset($map[$action])||($perms[$map[$action]]??false)!==true)reject('غير مصرح بهذه العملية.',403);
    if(str_starts_with($action,'lab.')&&!in_array($action,['lab.progress'],true)&&($perms['labProfit']??false)!==true)reject('تكلفة المعمل وحساباته خاصة بالحسابات المصرح لها.',403);
}
function checkHours(array $user, ?\DateTimeImmutable $instant=null): void {
    $s=$user['accessSchedule']??null;if(!is_array($s)||($s['enabled']??false)!==true)return;
    try{$d=($instant??new \DateTimeImmutable())->setTimezone(new \DateTimeZone($s['timezone']??'Africa/Cairo'));}catch(\Throwable){reject('جدول العمل غير صالح.',403);}
    if(!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/D',$s['startTime']??'')||!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/D',$s['endTime']??''))reject('جدول العمل غير صالح.',403);
    $minute=fn(string $v)=>(int)substr($v,0,2)*60+(int)substr($v,3,2);$start=$minute($s['startTime']);$end=$minute($s['endTime']);$current=(int)$d->format('H')*60+(int)$d->format('i');$weekday=(int)$d->format('w');
    if($start>$end&&$current<$end)$weekday=($weekday+6)%7;
    if($start===$end||!in_array($weekday,$s['days']??[],true)||!($start<$end?($current>=$start&&$current<$end):($current>=$start||$current<$end)))reject('الحساب غير متاح خارج أوقات العمل.',403,'session');
}
final class DB {
    public \PDO $pdo;
    public function __construct(array $config) {
        $d=$config['database'];$dsn=$d['test_sqlite_dsn']??('mysql:host='.$d['host'].';port='.($d['port']??3306).';dbname='.$d['name'].';charset=utf8mb4');
        if(isset($d['test_sqlite_dsn'])&&PHP_SAPI!=='cli'&&getenv('CLINIC_TEST_MODE')!=='1')reject('إعداد قاعدة غير مسموح.',503);
        $this->pdo=new \PDO($dsn,$d['user']??null,$d['password']??null,[\PDO::ATTR_ERRMODE=>\PDO::ERRMODE_EXCEPTION,\PDO::ATTR_DEFAULT_FETCH_MODE=>\PDO::FETCH_ASSOC,\PDO::ATTR_EMULATE_PREPARES=>false]);
    }
    public function q(string $sql,array $args=[]): \PDOStatement {$s=$this->pdo->prepare($sql);$s->execute($args);return $s;}
    public function one(string $sql,array $args=[]): ?array { $v=$this->q($sql,$args)->fetch();return $v===false?null:$v; }
    public function lock(): int { $suffix=$this->pdo->getAttribute(\PDO::ATTR_DRIVER_NAME)==='mysql'?' FOR UPDATE':'';$v=$this->one("SELECT value_json FROM dc_meta WHERE id='revision'".$suffix);if(!$v)reject('لم تكتمل تهيئة القاعدة.',503);return (int)decode($v['value_json']); }
    public function get(string $key,mixed $default=null):mixed{$r=$this->one('SELECT value_json FROM dc_meta WHERE id=?',[$key]);return $r?decode($r['value_json']):$default;}
    public function set(string $key,mixed $value):void{if($this->one('SELECT id FROM dc_meta WHERE id=?',[$key]))$this->q('UPDATE dc_meta SET value_json=? WHERE id=?',[json($value),$key]);else $this->q('INSERT INTO dc_meta(id,value_json) VALUES (?,?)',[$key,json($value)]);}
}
