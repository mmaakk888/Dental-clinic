<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(2);define('CLINIC_INTERNAL',true);
require __DIR__.'/../portable/api/core.php';require __DIR__.'/../portable/api/backup-service.php';
$config=require $argv[1];$d=$config['database'];if($d['host']!=='127.0.0.1'||(int)$d['port']!==33307||!preg_match('/^test_clinic_portable_[a-f0-9]{12}$/D',$d['name']))throw new RuntimeException('Synthetic loopback only');$db=new Clinic\DB($config);
if(($argv[2]??'')==='lock'){$h=fopen(dirname($argv[1]).'/system-updates/update.lock','c');flock($h,LOCK_EX);echo "locked\n";fflush(STDOUT);fgets(STDIN);flock($h,LOCK_UN);exit;}
if(($argv[2]??'')==='snapshot'){
    $data=[];foreach(Clinic\FullBackup::TABLES as $table){$rows=$db->q('SELECT * FROM `'.$table.'`')->fetchAll();$normalized=[];foreach($rows as $row){if($table==='dc_meta'&&(str_starts_with($row['id'],'update_')||str_starts_with($row['id'],'system_migration.')))continue;if($table==='dc_files')$row['content']=base64_encode($row['content']);foreach(array_keys($row) as $key)if(str_starts_with($key,'qa_update_'))unset($row[$key]);$normalized[]=Clinic\json($row);}sort($normalized,SORT_STRING);$data[$table]=$normalized;}
    echo Clinic\json(['digest'=>hash('sha256',Clinic\json($data)),'tables'=>$data]);exit;
}
if(($argv[2]??'')==='column'){echo Clinic\json(array_column($db->q('SHOW COLUMNS FROM dc_patients')->fetchAll(),'Field'));exit;}
if(($argv[2]??'')==='simulate-finalizing'){
    // Isolated fixture: represent a worker stopped after committing its finish
    // decision, before removing active.json. A later write must NOT be erased.
    $root=dirname($argv[1]).'/system-updates';$last=Clinic\decode(file_get_contents($root.'/last.json'));$last['state']='finalizing';$last['finishState']='completed';file_put_contents($root.'/'.$last['id'].'/job.json',Clinic\json($last));file_put_contents($root.'/active.json',Clinic\json(['job'=>$last['id']]));echo Clinic\json(['id'=>$last['id']]);exit;
}
throw new RuntimeException('Unknown test action');
