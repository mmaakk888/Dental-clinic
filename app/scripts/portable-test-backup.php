<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(2);define('CLINIC_INTERNAL',true);$c=require $argv[1];$d=$c['database'];
if($d['host']!=='127.0.0.1'||$d['port']!==33307||!preg_match('/^test_clinic_portable_[a-f0-9]{12}$/D',$d['name']))exit(2);
foreach(['core','auth','store','domain','importer'] as $name)require dirname(__DIR__).'/portable/api/'.$name.'.php';
$db=new Clinic\DB($c);$backup=Clinic\decode(file_get_contents($argv[2]));$db->pdo->beginTransaction();$db->set('revision',0);$db->set('lastFileNo',0);$db->set('settings',[]);$importer=new Clinic\Importer($db,$c);$importer->import($backup);$db->pdo->commit();
$counts=['patients'=>(int)$db->one('SELECT COUNT(*) AS n FROM dc_patients')['n'],'images'=>(int)$db->one('SELECT COUNT(*) AS n FROM dc_files')['n'],'users'=>(int)$db->one('SELECT COUNT(*) AS n FROM dc_users')['n']];
$db->pdo->beginTransaction();$result=$importer->import($backup);$db->pdo->commit();$counts['repeatIsIdempotent']=$result['alreadyImported']??false;
try{$importer->import(['format'=>'legacy-cloud','schemaVersion'=>1]);throw new RuntimeException('Legacy backup accepted.');}catch(Clinic\Fault $e){if($e->getCode()>=500)throw $e;}
echo json_encode($counts);
