<?php
declare(strict_types=1);
namespace Clinic;

/** Restores this application's own backup inside the caller's transaction,
 * into EMPTY operational tables. Never copies accounts or replaces records. */
final class Importer {
    public function __construct(public DB $db,public array $config){}
    public function import(array $backup):array {
        checkTree($backup);
        if(($backup['format']??'')!=='clinic-portable-data'||($backup['schemaVersion']??null)!==1)reject('اختر نسخة احتياطية من إصدار PHP/MySQL المتوافق؛ لا تُقبل ملفات النظام القديم.');
        $source=hash('sha256',json($backup));
        if($this->db->one('SELECT source_key FROM dc_import_sources WHERE source_hash=?',[$source]))return ['alreadyImported'=>true];
        foreach(['dc_patients','dc_contacts','dc_appointments','dc_labs','dc_lab_cases','dc_expenses','dc_material_usages'] as $table)if($this->db->one('SELECT id FROM '.$table.' LIMIT 1'))reject('النقل الكامل يتطلب قاعدة تشغيل فارغة؛ لن نمسح أو نستبدل سجلات قائمة.',409);
        $store=new Store($this->db);$domain=new Domain($this->db,$this->config);$counts=[];
        foreach($backup['_files']??[] as $file){$bytes=base64_decode($file['base64']??'',true);$info=$bytes===false?false:@getimagesizefromstring($bytes);if(!$info||strlen($bytes)>16*1024*1024||$info['mime']!==($file['mime']??null)||!in_array($file['ownerKind']??'',['logo','invoice'],true)||!in_array($info['mime'],['image/png','image/jpeg','image/webp'],true))reject('ملف منقول غير صالح؛ الأصل لم يتغير.');$this->db->q('INSERT INTO dc_files(id,owner_kind,owner_id,mime,byte_length,sha256,content) VALUES (?,?,?,?,?,?,?)',[id($file['id']),$file['ownerKind'],id($file['ownerId']),$file['mime'],strlen($bytes),hash('sha256',$bytes),$bytes]);}
        $settings=$this->db->get('settings',[]);
        foreach(['clinicName','clinicLogo','theme','prostheticRouting','drugCatalog','whatsappSettings','prescriptionHeader'] as $key)if(array_key_exists($key,$backup))$settings[$key]=$backup[$key];
        if(isset($backup['labels'],$backup['tileOrder']))$settings['content']=['labels'=>$backup['labels'],'tileOrder'=>$backup['tileOrder']];
        $catalog=$settings['serviceCatalog']??[];foreach(['serviceTypes','crownPrices','clinicalPrices','examinationFee'] as $key)if(array_key_exists($key,$backup))$catalog[$key]=$backup[$key];$settings['serviceCatalog']=$catalog;
        if(!empty($settings['clinicLogo']))$settings['clinicLogo']=$domain->image($settings['clinicLogo'],'logo','clinic');
        // Provider credentials belong to private server configuration, never backups.
        if(isset($settings['whatsappSettings'])){$settings['whatsappSettings']['apiKey']='';$settings['whatsappSettings']['webhookUrl']='';}
        $this->db->set('settings',$settings);$this->db->set('lastFileNo',max((int)$this->db->get('lastFileNo',0),(int)($backup['lastFileNo']??0)));
        $patients=[];
        foreach($backup['patients']??[] as $p){$file=(string)$p['id'];$sourceId=$p['_recordId']??(preg_match('/^[A-Za-z0-9_\-:.]{1,128}$/D',$file)?$file:null);$internal=$store->importProfile($p,$sourceId);$patients[$file]=$internal;
            foreach($p['sessions']??[] as $s){$key=id($s['id']);$total=money($s['amount']);$discount=money($s['discount']??0);if($discount>$total)reject('خصم تاريخي أكبر من الزيارة.');$logs=$s['paymentsLog']??[];$dated=0;foreach($logs as $r)if(empty($r['voidedAt']))$dated+=money($r['amount']);$historical=money($s['legacyOpeningPaid']??(!$logs?($s['paid']??0):0));if($dated+$historical>$total-$discount)reject('تحصيلات تاريخية تتجاوز المستحق.');$s['legacyOpeningPaid']=$historical/100;
                $this->db->q('INSERT INTO dc_visits(id,patient_id,visit_date,total_cents,historical_paid_cents,payload) VALUES (?,?,?,?,?,?)',[$key,$internal,day($s['date']),$total-$discount,$historical,json($s)]);
                foreach($logs as $r)$this->receipt($r,$internal,$key);
            }
            foreach($p['payments']??[] as $r)$this->receipt($r,$internal,null);
        }$counts['patients']=count($patients);
        foreach($backup['contacts']??[] as $v){$key=id($v['id']);$this->db->q('INSERT INTO dc_contacts(id,name,phone,payload) VALUES (?,?,?,?)',[$key,text($v['name'],200),phone($v['mobile']),json($v)]);}
        foreach($backup['appointments']??[] as $v){$key=id($v['id']);$file=(string)($v['patientId']??$v['fileNo']??'');$patient=$patients[$file]??null;if($file!==''&&!$patient)reject('موعد يشير إلى ملف غير موجود.');$date=day($v['date']);$time=$v['time'];if(!is_string($time)||!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/D',$time))reject('وقت موعد تاريخي غير صالح.');$start=(int)substr($time,0,2)*60+(int)substr($time,3);$duration=$v['durationMinutes']??30;if(!is_int($duration)||$duration<=0||$start+$duration>1440)reject('مدة موعد غير صالحة.');$this->db->q('INSERT INTO dc_appointments(id,patient_id,appointment_date,start_minute,duration_minutes,status,payload) VALUES (?,?,?,?,?,?,?)',[$key,$patient,$date,$start,$duration,text($v['status']??'scheduled',24),json($v)]);}
        foreach($backup['labs']??[] as $v)$this->db->q('INSERT INTO dc_labs(id,name,payload,archived) VALUES (?,?,?,?)',[id($v['id']),text($v['name'],191),json($v),(int)($v['_archived']??false)]);
        $payments=[];
        foreach($backup['labCases']??[] as $v){$key=id($v['id']);$patient=$patients[(string)$v['patientId']]??null;if(!$patient)reject('حالة معمل تشير إلى ملف مفقود.');$visit=$v['linkedSessionId']??null;if($visit){$r=$this->db->one('SELECT patient_id FROM dc_visits WHERE id=?',[id($visit)]);if(!$r||$r['patient_id']!==$patient)reject('ربط جلسة معمل غير صالح.');}$total=money($v['labTotal']);$paid=money($v['labPaid']??0);if($paid>$total)reject('حساب معمل غير صالح.');$this->db->q('INSERT INTO dc_lab_cases(id,patient_id,visit_id,lab_id,total_cost_cents,payload) VALUES (?,?,?,?,?,?)',[$key,$patient,$visit,id($v['labId']),$total,json($v)]);
            foreach($v['paymentsLog']??[] as $payment){if(!empty($payment['voidedAt']))continue;$pid=id($payment['id']);$group=$pid.'|'.$v['labId'];if(!isset($payments[$group]))$payments[$group]=['id'=>$pid,'labId'=>$v['labId'],'date'=>day($payment['date']),'amount'=>0,'allocations'=>[],'payload'=>$payment];if($payments[$group]['date']!==$payment['date'])reject('معرّف دفعة معمل مكرر بتواريخ مختلفة.');$amount=money($payment['amount']);$payments[$group]['amount']+=$amount;$payments[$group]['allocations'][$key]=($payments[$group]['allocations'][$key]??0)+$amount;}
        }
        foreach($payments as $payment){$this->db->q('INSERT INTO dc_lab_payments(id,lab_id,amount_cents,paid_date,payload) VALUES (?,?,?,?,?)',[$payment['id'],$payment['labId'],$payment['amount'],$payment['date'],json($payment['payload'])]);foreach($payment['allocations'] as $case=>$amount)$this->db->q('INSERT INTO dc_lab_allocations(payment_id,case_id,amount_cents) VALUES (?,?,?)',[$payment['id'],$case,$amount]);}
        foreach($backup['expenses']??[] as $v){$key=id($v['id']);$total=money($v['amount']);if(!array_key_exists('paidAmount',$v))reject('مصروف تاريخي بلا مبلغ مدفوع صريح؛ حدده في ملف المراجعة دون تخمين.');$paid=money($v['paidAmount']);if($paid>$total)reject('مصروف مدفوعه أكبر من إجماليه.');if(!empty($v['invoiceImageUrl']))$v['invoiceImageUrl']=$domain->image($v['invoiceImageUrl'],'invoice',$key);$sum=0;foreach($v['paymentsLog']??[] as $payment)if(empty($payment['voidedAt']))$sum+=money($payment['amount']);if($sum>$paid)reject('دفعات المورد تتجاوز المدفوع.');$v['legacyOpeningPaid']=($paid-$sum)/100;$this->db->q('INSERT INTO dc_expenses(id,expense_date,category,total_cents,paid_cents,payload) VALUES (?,?,?,?,?,?)',[$key,day($v['date']),text($v['category'],32),$total,$paid,json($v)]);
            foreach($v['paymentsLog']??[] as $payment)if(empty($payment['voidedAt']))$this->db->q('INSERT INTO dc_expense_payments(id,expense_id,amount_cents,paid_date,payload) VALUES (?,?,?,?,?)',[id($payment['id']),$key,money($payment['amount']),day($payment['date']),json($payment)]);
            foreach($v['items']??[] as $i){$quantity=$i['quantity']??null;if(!is_numeric($quantity)||$quantity<=0||abs($quantity*1000-round($quantity*1000))>0.0001)reject('كمية تاريخية غير صالحة.');$this->db->q('INSERT INTO dc_expense_items(id,expense_id,material_key,quantity_milli,total_cents,payload) VALUES (?,?,?,?,?,?)',[id($i['id']),$key,materialKey($i['itemName'],$i['unit']??'قطعة'),(int)round($quantity*1000),money($i['inventoryCost']??$i['total']),json($i)]);}
        }
        foreach($backup['materialUsages']??[] as $v){$parts=explode('|',$v['materialKey'],2);$quantity=$v['quantity'];if(!is_numeric($quantity)||$quantity<=0)reject();$cost=money($v['_costTotal']??$v['costTotal']??round($quantity*$v['unitCostAtUse'],2));$this->db->q('INSERT INTO dc_material_usages(id,material_key,usage_date,quantity_milli,cost_cents,payload) VALUES (?,?,?,?,?,?)',[id($v['id']),materialKey($parts[0],$parts[1]??''),day($v['date']),(int)round($quantity*1000),$cost,json($v)]);}
        foreach(['contacts','appointments','labs','labCases','expenses','materialUsages'] as $key)$counts[$key]=count($backup[$key]??[]);
        $this->db->q('INSERT INTO dc_import_sources(source_key,source_hash,imported_at,details_json) VALUES (?,?,?,?)',['import:'.$source,$source,now(),json($counts)]);return $counts;
    }
    private function receipt(array $r,string $patient,?string $visit):void {
        $amount=money($r['amount']);
        // Effective cash is zero for a voided receipt; preserve its original
        // amount, date, reason and ID in payload and the rendered history.
        $this->db->q('INSERT INTO dc_receipts(id,patient_id,visit_id,amount_cents,paid_date,payload) VALUES (?,?,?,?,?,?)',[id($r['id']),$patient,$visit,empty($r['voidedAt'])?$amount:0,day($r['date']),json($r)]);
    }
}
