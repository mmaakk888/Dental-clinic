<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(2);define('CLINIC_INTERNAL',true);
require __DIR__.'/../portable/api/core.php';require __DIR__.'/../portable/api/backup-service.php';require __DIR__.'/../portable/api/update-service.php';
$config=require $argv[1];$d=$config['database'];if($d['host']!=='127.0.0.1'||(int)$d['port']!==33307||!preg_match('/^test_clinic_portable_[a-f0-9]{12}$/D',$d['name']))throw new RuntimeException('Synthetic loopback only');
$db=new Clinic\DB($config);$update=new Clinic\SystemUpdate($db,$config,$argv[2],dirname($argv[1]));$v=$update->inspect($argv[3]);echo Clinic\json(['signatureValid'=>true,'from'=>$v['manifest']['from'],'to'=>$v['manifest']['to'],'files'=>count($v['files']),'manifestSha'=>$v['manifestSha']]).PHP_EOL;
