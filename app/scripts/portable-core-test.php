<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(2);
require dirname(__DIR__).'/portable/api/core.php';
use Clinic\Fault;
use function Clinic\{checkHours,ratio,inventoryCosts,phone,day};
$checks=0;
function check(bool $value,string $message):void{global $checks;if(!$value)throw new RuntimeException($message);$checks++;}
function denied(callable $action,string $message):void{try{$action();}catch(Fault){check(true,$message);return;}throw new RuntimeException($message);}
$user=['accessSchedule'=>['enabled'=>true,'days'=>[1],'startTime'=>'22:00','endTime'=>'02:00','timezone'=>'UTC']];
checkHours($user,new DateTimeImmutable('2026-10-19T22:00:00Z'));check(true,'inclusive opening');
checkHours($user,new DateTimeImmutable('2026-10-20T01:59:00Z'));check(true,'overnight belongs to opening weekday');
denied(fn()=>checkHours($user,new DateTimeImmutable('2026-10-20T02:00:00Z')),'exclusive closing');
denied(fn()=>checkHours($user,new DateTimeImmutable('2026-10-20T22:00:00Z')),'wrong weekday');
denied(fn()=>day('2026-02-30'),'invalid calendar date');
check(day('2028-02-29')==='2028-02-29','leap date');
check(phone('٠١٠ ١١١١ ١١١١')==='201011111111','Arabic phone');
check(phone('0101111111')==='','truncated mobile');
check(ratio(1000000000000,999999999999,1000000000000)===[999999999999,0],'large ratio without intermediate overflow');
check(ratio(10,10,3)===[33,1],'exact remainder');
check(inventoryCosts([['id'=>'a','total'=>1],['id'=>'b','total'=>1],['id'=>'c','total'=>1]],100)===[34,33,33],'rounding preserves actual cost');
echo json_encode(['checks'=>$checks,'syntheticOnly'=>true]),PHP_EOL;
