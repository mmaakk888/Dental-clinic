<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
// Offline reset SQL, no password collection, hash migration or public admin API.
$options=getopt('',['user:','url:','output:']);
try{$id=$options['user']??'';$url=$options['url']??'';$output=$options['output']??'';if(!preg_match('/^[A-Za-z0-9_\-:.]{1,128}$/D',$id)||!filter_var($url,FILTER_VALIDATE_URL)||!str_starts_with($url,'https://')||!$output||file_exists($output))throw new RuntimeException('Use --user=UID --url=https://domain --output=NEW-private-reset.sql');$token=bin2hex(random_bytes(32));$expires=time()+3600;$sql="-- PRIVATE one-use password reset, expires in one hour.\nINSERT INTO dc_password_resets(token_hash,user_id,expires_at) SELECT '".hash('sha256',$token)."',0x".bin2hex($id).",$expires WHERE EXISTS(SELECT id FROM dc_users WHERE id=0x".bin2hex($id).");\n";$h=fopen($output,'x');fwrite($h,$sql);fclose($h);@chmod($output,0600);echo "Import the private SQL in phpMyAdmin, then open this link yourself (do not share it in chat):\n".rtrim($url,'/').'/reset.html#'.$token.PHP_EOL;}catch(Throwable $e){fwrite(STDERR,$e->getMessage().PHP_EOL);exit(1);}
