<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(2);define('CLINIC_INTERNAL',true);$c=require $argv[1];$d=$c['database'];
if($d['host']!=='127.0.0.1'||$d['port']!==33307||!preg_match('/^test_clinic_portable_[a-f0-9]{12}$/D',$d['name']))exit(2);
$pdo=new PDO('mysql:host=127.0.0.1;port=33307;dbname='.$d['name'].';charset=utf8mb4',$d['user'],$d['password']);
$counts=[];foreach($pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $table)$counts[$table]=(int)$pdo->query('SELECT COUNT(*) FROM `'.$table.'`')->fetchColumn();
foreach($counts as $table=>$n)if(!in_array($table,['dc_meta','dc_users'],true)&&$n!==0)throw new RuntimeException('Unexpected initial rows: '.$table);
if($counts['dc_users']!==1||$counts['dc_meta']!==4)throw new RuntimeException('Installer must create one owner and four settings/lock rows only.');
echo json_encode(['tables'=>$counts,'ownerOnly'=>true]);
