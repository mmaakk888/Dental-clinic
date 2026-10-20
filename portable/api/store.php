<?php
declare(strict_types=1);
namespace Clinic;

final class Store {
    public function __construct(public DB $db) {}
    public function rows(string $table):array {$where=in_array($table,['dc_contacts','dc_labs','dc_expenses','dc_material_usages'],true)?' WHERE archived=0':'';return array_map(fn($r)=>decode($r['payload']),$this->db->q('SELECT payload FROM '.$this->table($table).$where)->fetchAll());}
    private function table(string $value):string {if(!in_array($value,['dc_patients','dc_visits','dc_receipts','dc_contacts','dc_appointments','dc_labs','dc_lab_cases','dc_expenses','dc_material_usages'],true))reject();return $value;}
    public function patient(string $file):array {$r=$this->db->one('SELECT * FROM dc_patients WHERE (file_no=? OR id=?) AND archived=0',[$file,$file]);if(!$r)reject('ملف المريض غير موجود.',404);return $r;}
    public function profile(array $p):array {$d=decode($p['payload']);$d['id']=$p['file_no'];return $d;}
    public function fullPatients():array {
        $profiles=$this->db->q('SELECT * FROM dc_patients WHERE archived=0 ORDER BY file_no')->fetchAll();$visits=$this->db->q('SELECT * FROM dc_visits WHERE archived=0 ORDER BY visit_date DESC,id')->fetchAll();$receipts=$this->db->q('SELECT * FROM dc_receipts ORDER BY paid_date,id')->fetchAll();
        $byPatient=[];$byVisit=[];$general=[];foreach($visits as $v)$byPatient[$v['patient_id']][]=$v;foreach($receipts as $r){if($r['visit_id']===null)$general[$r['patient_id']][]=$r;else $byVisit[$r['visit_id']][]=$r;}
        $result=[];foreach($profiles as $p){$d=$this->profile($p);$d['sessions']=[];$d['payments']=[];
            foreach($byPatient[$p['id']]??[] as $v){$s=decode($v['payload']);$s['id']=$v['id'];$s['amount']=$s['amount']??(int)$v['total_cents']/100;$s['paymentsLog']=[];$paid=(int)$v['historical_paid_cents'];$s['legacyOpeningPaid']=$paid/100;
                foreach($byVisit[$v['id']]??[] as $r){$payment=decode($r['payload']);$payment['id']=$r['id'];if(empty($payment['voidedAt']))$payment['amount']=(int)$r['amount_cents']/100;$payment['date']=$r['paid_date'];$s['paymentsLog'][]=$payment;$paid+=(int)$r['amount_cents'];}
                $s['paid']=$paid/100;$s['remain']=((int)$v['total_cents']-$paid)/100;$d['sessions'][]=$s;
            }
            foreach($general[$p['id']]??[] as $r){$payment=decode($r['payload']);$payment['id']=$r['id'];if(empty($payment['voidedAt']))$payment['amount']=(int)$r['amount_cents']/100;$payment['date']=$r['paid_date'];$d['payments'][]=$payment;}
            $result[]=$d;
        }return $result;
    }
    public function snapshot(array $user):array {
        $settings=$this->db->get('settings',[]);$patients=$this->fullPatients();$labs=$this->rows('dc_labs');$cases=$this->rows('dc_lab_cases');$expenses=$this->rows('dc_expenses');$usages=$this->rows('dc_material_usages');$contacts=$this->rows('dc_contacts');$appointments=$this->rows('dc_appointments');
        foreach($cases as &$case)if(!empty($case['linkedSessionId'])){$v=$this->db->one('SELECT total_cents,historical_paid_cents FROM dc_visits WHERE id=?',[$case['linkedSessionId']]);$paid=$this->db->one('SELECT COALESCE(SUM(amount_cents),0) AS n FROM dc_receipts WHERE visit_id=?',[$case['linkedSessionId']]);if(!$v)reject('تركيبة بلا جلسة مرتبطة؛ راجع تقرير النقل.',409);$case['patientTotal']=(int)$v['total_cents']/100;$case['patientPaid']=((int)$paid['n']+(int)$v['historical_paid_cents'])/100;}unset($case);
        $users=array_map(fn($r)=> (new Auth($this->db,['app_url'=>'']))->profile($r),$this->db->q('SELECT * FROM dc_users')->fetchAll());
        // No supplier costs, private routing, expense ledgers, user hashes or API keys reach reception clients.
        if(!owner($user)){
            $users=[$user];$perms=$user['permissions']??[];unset($settings['prostheticRouting']);
            if(($perms['lab']??false)!==true){$labs=[];$cases=[];}elseif(($perms['labProfit']??false)!==true){foreach($labs as &$l)$l=array_intersect_key($l,array_flip(['id','name','phone','address','notes']));unset($l);foreach($cases as &$c)$c=array_intersect_key($c,array_flip(['id','labId','labName','patientId','fileNo','patientName','type','subType','units','unitLabel','date','teethIds','status','note','linkedSessionId','deliveryExpectedDate','patientTotal','patientPaid']));unset($c);}
            if(($perms['viewExpenses']??$perms['summary']??false)!==true){$expenses=[];$usages=[];}
            if(($user['permissions']['patientView']??false)!==true){$patients=[];$contacts=[];}
            if(($user['permissions']['appointments']??false)!==true)$appointments=[];
            if(($user['permissions']['patientFinance']??false)!==true)foreach($cases as &$c){unset($c['patientTotal'],$c['patientPaid']);}unset($c);
            if(($user['permissions']['patientFinance']??false)!==true)foreach($patients as &$p){$p['payments']=[];foreach($p['sessions'] as &$s)$s=array_intersect_key($s,array_flip(['id','type','date','teethIds','tooth','toothLabel','toothNum','visitNotes','treatmentStage','rootCanalStatus','visitStatus','chiefComplaint','diagnosis','procedurePerformed','prescriptionNotes','doctorName','time','isWalkIn']));unset($s);}unset($p);
        }
        $settings['labs']=$labs;
        if(isset($settings['whatsappSettings'])){unset($settings['whatsappSettings']['apiKey'],$settings['whatsappSettings']['webhookUrl']);$settings['whatsappSettings']['apiKey']='';$settings['whatsappSettings']['webhookUrl']='';}
        return ['schemaVersion'=>1,'revision'=>$this->db->get('revision',0),'user'=>$user,'users'=>$users,'domain'=>['patients'=>$patients,'contacts'=>$contacts,'appointments'=>$appointments,'labCases'=>$cases,'expenses'=>$expenses,'materialUsages'=>$usages],'settings'=>$settings];
    }
    public function saveProfile(array $input,?string $original=null):string {
        $name=text($input['name']??'',200);if($name==='')reject('اسم المريض مطلوب.');$rawPhone=text($input['mobile']??'',60);if($rawPhone!==''&&!phone($rawPhone))reject('رقم الهاتف غير صالح.');$age=$input['age']??0;if(!is_int($age)||$age<0||$age>120)reject('العمر غير صالح.');
        if($original!==null){$row=$this->patient($original);$recordId=$row['id'];$file=$row['file_no'];}
        else{$last=(int)$this->db->get('lastFileNo',0);$requested=$input['id']??null;
            if($last<0||$last>=2000000000)reject('عداد الملفات غير صالح أو بلغ الحد؛ راجعه قبل الإنشاء.');$file=(string)($last+1);if($requested!==null&&$requested!==''&&(string)$requested!==$file)reject('تغيّر رقم الملف التالي؛ حدّث القائمة قبل الإضافة.',409);$recordId=uuid();$this->db->set('lastFileNo',$last+1);}
        $prior=$original!==null?decode($row['payload']):[];
        $profile=array_merge($prior,['id'=>$file,'name'=>$name,'mobile'=>$rawPhone,'age'=>$age,'gender'=>text($input['gender']??'',16),'firstVisit'=>array_key_exists('firstVisit',$input)?($input['firstVisit']!==''?day($input['firstVisit']):''):($prior['firstVisit']??date('Y-m-d')),'notes'=>text($input['notes']??''),'allergy'=>text($input['allergy']??'')]);
        if($original!==null)$this->db->q('UPDATE dc_patients SET name=?,phone=?,payload=?,revision=revision+1 WHERE id=?',[$name,phone($rawPhone),json($profile),$recordId]);
        else $this->db->q('INSERT INTO dc_patients(id,file_no,name,phone,payload) VALUES (?,?,?,?,?)',[$recordId,$file,$name,phone($rawPhone),json($profile)]);
        return $file;
    }
    public function backup(array $user):array {
        permit($user,'backup');$s=$this->snapshot($user);$out=array_merge($s['domain'],$s['settings'],$s['settings']['content']??[],$s['settings']['serviceCatalog']??[]);unset($out['content'],$out['serviceCatalog']);$out['users']=$s['users'];$out['format']='clinic-portable-data';$out['schemaVersion']=1;$out['exportedAt']=now();$out['lastFileNo']=$this->db->get('lastFileNo',0);
        $map=[];foreach($this->db->q('SELECT id,file_no FROM dc_patients WHERE archived=0')->fetchAll() as $p)$map[$p['file_no']]=$p['id'];foreach($out['patients'] as &$p)$p['_recordId']=$map[$p['id']];unset($p);
        $out['_files']=array_map(fn($f)=>['id'=>$f['id'],'ownerKind'=>$f['owner_kind'],'ownerId'=>$f['owner_id'],'mime'=>$f['mime'],'base64'=>base64_encode($f['content'])],$this->db->q('SELECT * FROM dc_files')->fetchAll());
        $out['notice']='Clinical/settings/files backup only. User metadata has no password hashes. Use phpMyAdmin SQL backup for complete server recovery.';return $out;
    }
    public function importProfile(array $input,?string $internalId=null):string {
        $file=text((string)($input['id']??''),128);if($file==='')reject('معرّف ملف فارغ في النقل.');$number=digits($file);if(ctype_digit($number)&&(strlen(ltrim($number,'0'))>10||(int)$number>2000000000))reject('رقم الملف يتجاوز الحد.');$recordId=$internalId===null?uuid():id($internalId);$name=text($input['name']??'',200);if(!$name)reject('اسم ملف مفقود.');$p=$input;unset($p['sessions'],$p['payments'],$p['_recordId']);$p['id']=$file;$mobile=text($p['mobile']??'',60);$this->db->q('INSERT INTO dc_patients(id,file_no,name,phone,payload) VALUES (?,?,?,?,?)',[$recordId,$file,$name,phone($mobile),json($p)]);if(ctype_digit($number))$this->db->set('lastFileNo',max((int)$this->db->get('lastFileNo',0),(int)$number));return $recordId;
    }
}
