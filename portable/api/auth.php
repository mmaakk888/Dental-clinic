<?php
declare(strict_types=1);
namespace Clinic;

final class Auth {
    public string $cookie='clinic_session';
    public function __construct(public DB $db, public array $config) { $this->cookie='clinic_'.substr(hash('sha256',$config['app_url']),0,12); }
    public function token(): string { $s=$_COOKIE[$this->cookie]??'';return is_string($s)&&preg_match('/^[a-f0-9]{64}$/D',$s)?$s:''; }
    public function csrf(): string { return hash_hmac('sha256','csrf:'.$this->token(),$this->config['app_key']); }
    public function guardCsrf():void {
        $origin=$_SERVER['HTTP_ORIGIN']??'';$url=parse_url($this->config['app_url']);$expected=$url['scheme'].'://'.$url['host'].(isset($url['port'])?':'.$url['port']:'');
        if($origin!==$expected||!hash_equals($this->csrf(),$_SERVER['HTTP_X_CSRF_TOKEN']??''))reject('تعذر تأكيد مصدر الطلب؛ حدّث الصفحة.',403);
    }
    public function profile(array $row): array {
        $p=decode($row['profile_json']);unset($p['password']);$p['passwordConfigured']=!empty($row['password_hash']);$p['id']=$row['id'];$p['username']=$row['username'];$p['email']=$row['email']??'';$p['credentialVersion']=(int)$row['credential_version'];$p['isActive']=(bool)$row['is_active'];return $p;
    }
    public function current(bool $required=true):?array {
        $token=$this->token();$r=$token?$this->db->one('SELECT u.*,s.credential_version AS session_version,s.expires_at FROM dc_sessions s JOIN dc_users u ON u.id=s.user_id WHERE s.token_hash=?',[hash('sha256',$token)]):null;
        if(!$r||(int)$r['expires_at']<=time()||!(bool)$r['is_active']||(int)$r['session_version']!==(int)$r['credential_version']){if($required)reject('سجّل الدخول من جديد.',401);return null;}
        $u=$this->profile($r);checkHours($u);return $u;
    }
    private function setCookie(string $token,int $expires):void {
        $https=str_starts_with($this->config['app_url'],'https://');
        setcookie($this->cookie,$token,['expires'=>$expires,'path'=>parse_url($this->config['app_url'],PHP_URL_PATH)?:'/','secure'=>$https,'httponly'=>true,'samesite'=>'Strict']);$_COOKIE[$this->cookie]=$token;
    }
    private function audit(string $userId,string $action):void {
        $this->db->q('INSERT INTO dc_audit(id,actor_id,action,entity_id,created_at,details_json) VALUES (?,?,?,?,?,?)',[uuid(),$userId,$action,$userId,now(),'{}']);
    }
    public function login(array $data):array {
        $username=text($data['username']??'',191);$password=$data['password']??null;if(!is_string($password)||strlen($password)>4096||$username==='')reject('بيانات الدخول غير صحيحة.',401);
        $bucket=hash('sha256',strtolower($username).'|'.($_SERVER['REMOTE_ADDR']??'unknown'));
        $this->throttle($bucket,8);$accountBucket=hash('sha256','account:'.strtolower($username));$this->throttle($accountBucket,25);$this->throttle(hash('sha256','peer:'.($_SERVER['REMOTE_ADDR']??'unknown')),60);
        $u=$this->db->one('SELECT * FROM dc_users WHERE username=?',[$username]);if(!$u){$matches=$this->db->q('SELECT * FROM dc_users WHERE email=?',[$username])->fetchAll();$u=count($matches)===1?$matches[0]:null;}
        // Do an expensive hash even for unknown accounts; never expose whether an email exists.
        $valid=password_verify($password,$u['password_hash']??'$2y$12$9BR0/QtNTmE8MLNl7VsyVe1usK1YzJVxZiLpV/o2ZutYC0dAEGjya');
        if(!$u||!$valid||!(bool)$u['is_active'])reject('بيانات الدخول غير صحيحة أو الحساب يحتاج إعادة تعيين.',401);
        $profile=$this->profile($u);checkHours($profile);
        $this->db->q('DELETE FROM dc_login_limits WHERE bucket=? OR bucket=?',[$bucket,$accountBucket]);
        if(strlen($password)>72)reject('أعد تعيين كلمة السر لتكون ضمن الحد الآمن.',401);
        if(password_needs_rehash($u['password_hash'],PASSWORD_BCRYPT,['cost'=>12]))$this->db->q('UPDATE dc_users SET password_hash=? WHERE id=?',[passwordHash($password),$u['id']]);
        $this->logout(false);$token=bin2hex(random_bytes(32));$seconds=$this->config['session_seconds'];
        $this->db->q('INSERT INTO dc_sessions(token_hash,user_id,credential_version,expires_at,created_at) VALUES (?,?,?,?,?)',[hash('sha256',$token),$u['id'],$u['credential_version'],time()+$seconds,time()]);
        $this->setCookie($token,0);$this->audit($u['id'],'auth.login');return $profile;
    }
    private function throttle(string $bucket,int $limit):void {
        $this->db->q('INSERT INTO dc_login_limits(bucket,attempts,expires_at) VALUES (?,1,?) ON DUPLICATE KEY UPDATE attempts=IF(expires_at>UNIX_TIMESTAMP(),attempts+1,1),expires_at=IF(expires_at>UNIX_TIMESTAMP(),expires_at,UNIX_TIMESTAMP()+900)',[$bucket,time()+900]);$row=$this->db->one('SELECT attempts FROM dc_login_limits WHERE bucket=?',[$bucket]);if((int)$row['attempts']>$limit)reject('محاولات كثيرة؛ انتظر ١٥ دقيقة.',429);
    }
    public function remember(bool $remember):void {
        $u=$this->current();$seconds=$remember?$this->config['remember_seconds']:$this->config['session_seconds'];$expires=time()+$seconds;
        $this->db->q('UPDATE dc_sessions SET expires_at=? WHERE token_hash=? AND user_id=?',[$expires,hash('sha256',$this->token()),$u['id']]);$this->setCookie($this->token(),$remember?$expires:0);
    }
    public function logout(bool $clear=true):void {if($this->token()){$row=$this->db->one('SELECT user_id FROM dc_sessions WHERE token_hash=?',[hash('sha256',$this->token())]);$this->db->q('DELETE FROM dc_sessions WHERE token_hash=?',[hash('sha256',$this->token())]);if($clear&&$row)$this->audit($row['user_id'],'auth.logout');}if($clear)$this->setCookie('',time()-3600);}
    public function reset(array $input):void {
        $token=$input['token']??'';$password=$input['password']??'';if(!is_string($token)||!preg_match('/^[a-f0-9]{64}$/D',$token)||!is_string($password)||strlen($password)<12||strlen($password)>4096)reject('رابط أو كلمة سر غير صالحين.');
        $this->db->pdo->beginTransaction();try{$this->db->lock();$row=$this->db->one('SELECT * FROM dc_password_resets WHERE token_hash=?',[hash('sha256',$token)]);
            if(!$row||$row['used_at']!==null||(int)$row['expires_at']<=time())reject('الرابط منتهي أو مستخدم.');
            $this->db->q('UPDATE dc_users SET password_hash=?,credential_version=credential_version+1 WHERE id=?',[passwordHash($password),$row['user_id']]);
            $this->db->q('UPDATE dc_password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL',[time(),$row['user_id']]);$this->db->q('DELETE FROM dc_sessions WHERE user_id=?',[$row['user_id']]);$this->audit($row['user_id'],'auth.reset');$this->db->pdo->commit();
        }catch(\Throwable $e){if($this->db->pdo->inTransaction())$this->db->pdo->rollBack();throw $e;}
    }
}
