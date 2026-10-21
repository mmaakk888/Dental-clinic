<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(2);define('CLINIC_INTERNAL',true);
try{$path=$argv[1]??'';$api=$argv[2]??'';if(!$path||!is_file($path)||!is_dir($api))throw new RuntimeException('Use: php backup-cron.php /private/config.php /htdocs/api');foreach(['core','backup-service','backup-delivery'] as $file)require $api.'/'.$file.'.php';$config=require $path;$backup=new Clinic\FullBackup(new Clinic\DB($config),$config);echo Clinic\json((new Clinic\BackupDelivery($backup))->cron()).PHP_EOL;}catch(Throwable $e){fwrite(STDERR,'Backup cron failed. Check backup status in admin settings.'.PHP_EOL);exit(1);}
