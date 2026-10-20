<?php
declare(strict_types=1);
// Outside htdocs only. Requires shell access to the private configuration.
if(PHP_SAPI!=='cli')exit(2);define('CLINIC_INTERNAL',true);
try{
    $configPath=$argv[1]??'';$public=$argv[2]??'';if(!is_file($configPath)||!is_dir($public)||($argv[3]??'')!=='--rollback')throw new RuntimeException('Use: php update-recover.php /private/config.php /htdocs --rollback');
    $private=dirname(realpath($configPath));$active=json_decode(file_get_contents($private.'/system-updates/active.json'),true,16,JSON_THROW_ON_ERROR);$id=$active['job']??'';if(!preg_match('/^[a-f0-9]{32}$/D',$id))throw new RuntimeException('No valid active job');
    $engine=$private.'/system-updates/'.$id.'/engine';foreach(['core','auth','backup-service','update-service'] as $name)require $engine.'/'.$name.'.php';$config=require $configPath;$db=new Clinic\DB($config);$update=new Clinic\SystemUpdate($db,$config,realpath($public),$private);$state=$update->status();echo Clinic\json($update->recover($id,$state['job']['actor'])).PHP_EOL;
}catch(Throwable $e){fwrite(STDERR,'Recovery was not confirmed. Keep maintenance enabled and preserve the private system-updates folder.'.PHP_EOL);exit(1);}
