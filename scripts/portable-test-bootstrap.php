<?php
declare(strict_types=1);
// Explicit, synthetic loopback test database only. Never accepts production DSN.
$name=$argv[1]??'';$output=$argv[2]??'';$port=(int)($argv[3]??4186);if(!in_array($port,[4186,4189],true))exit(2);
if(!preg_match('/^test_clinic_portable_[a-f0-9]{12}$/D',$name)||!$output)exit(2);
$pdo=new PDO('mysql:host=127.0.0.1;port=33307;charset=utf8mb4','root','LocalSyntheticOnly_MigrationTest_2026',[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE DATABASE `'.$name.'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');$pdo->exec('USE `'.$name.'`');
$sql=file_get_contents(dirname(__DIR__).'/portable/schema.sql');foreach(explode(';',$sql) as $statement)if(trim($statement))$pdo->exec($statement);
$config=['app_url'=>'http://127.0.0.1:'.$port,'app_key'=>bin2hex(random_bytes(32)),'install_token'=>bin2hex(random_bytes(32)),'database'=>['host'=>'127.0.0.1','port'=>33307,'name'=>$name,'user'=>'root','password'=>'LocalSyntheticOnly_MigrationTest_2026'],'timezone'=>'Africa/Cairo','session_seconds'=>43200,'remember_seconds'=>604800,'max_upload_bytes'=>153600,'allow_http_loopback'=>true];
file_put_contents($output,"<?php if(!defined('CLINIC_INTERNAL')){http_response_code(404);exit;} return ".var_export($config,true).';');echo json_encode(['database'=>$name,'installToken'=>$config['install_token']]);
