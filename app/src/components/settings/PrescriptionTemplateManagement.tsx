import React, {useEffect, useRef, useState} from 'react';
import {FileText, RotateCcw, Save} from 'lucide-react';
import {normalizePrescriptionTemplate, validatePrescriptionTemplate, type PrescriptionTemplate, type PrescriptionDesign} from '../../utils/prescriptionTemplate';
import {PrescriptionPaperPreview} from '../patient/PrescriptionPaperPreview';
import {useConfirmedAction} from '../common/useConfirmedAction';
import {useToastAndConfirm} from '../common/ToastAndConfirm';
import {localDateISO} from '../appointments/appointmentScheduling';
import './prescriptionTemplate.css';

interface Props {value: PrescriptionTemplate; clinicName: string; clinicLogo: string | null; onSave(value: PrescriptionTemplate): Promise<unknown>; onDirtyChange?(dirty: boolean): void}
export function PrescriptionTemplateManagement({value, clinicName, clinicLogo, onSave, onDirtyChange}: Props) {
  const [draft, setDraft] = useState(() => normalizePrescriptionTemplate(value));
  const incoming = JSON.stringify(normalizePrescriptionTemplate(value));
  const [baseline, setBaseline] = useState(incoming), remote = useRef(incoming);
  const signature = JSON.stringify(draft), dirty = signature !== baseline;
  const [conflict, setConflict] = useState(false);
  const {saving, run} = useConfirmedAction(), {showToast, askConfirm} = useToastAndConfirm();
  useEffect(() => {
    if (incoming === remote.current) return;
    if (!dirty || signature === incoming) {setDraft(normalizePrescriptionTemplate(value)); setBaseline(incoming); setConflict(false);}
    else setConflict(true);
    remote.current = incoming;
  }, [incoming]);
  useEffect(() => {onDirtyChange?.(dirty); return () => onDirtyChange?.(false);}, [dirty, onDirtyChange]);
  const header = <K extends keyof PrescriptionTemplate['header']>(key: K, value: string) => setDraft(current => ({...current, header: {...current.header, [key]: value}}));
  const design = <K extends keyof PrescriptionDesign>(key: K, value: PrescriptionDesign[K]) => setDraft(current => ({...current, design: {...current.design, [key]: value}}));
  const resetSaved = () => {setDraft(normalizePrescriptionTemplate(value)); setBaseline(incoming); setConflict(false);};
  const save = (event: React.FormEvent) => {event.preventDefault(); if (!dirty || conflict) return; void run(async () => {
    const next = normalizePrescriptionTemplate(draft); validatePrescriptionTemplate(next); await onSave(next);
    setDraft(next); setBaseline(JSON.stringify(next)); setConflict(false); showToast('حُفظ تصميم العيادة للروشتات الجديدة؛ الروشتات المحفوظة لم تتغير.', 'success');
  });};
  return <section className="rx-design-settings" dir="rtl" aria-labelledby="rx-design-title">
    <header className="rx-design-heading"><div><h2 id="rx-design-title"><FileText aria-hidden="true"/>تصميم الروشتة</h2><p>عدّل الورقة المعتمدة هنا. المعاينة والطباعة والصورة المرسلة تستخدم نفس التصميم، دون تغيير الروشتات السابقة.</p></div><span role="status">{dirty ? 'تعديلات غير محفوظة' : 'التصميم المحفوظ'}</span></header>
    {conflict && <p role="alert" className="rx-design-notice">تغيّر التصميم المحفوظ من جلسة أخرى. مسودتك محفوظة هنا؛ استرجع المحفوظ قبل الحفظ لمنع استبدال التعديل الآخر.</p>}
    <div className="rx-design-layout">
      <form onSubmit={save} className="rx-design-form"><fieldset disabled={saving}>
        <section className="rx-design-card"><h3>١. بيانات الطبيب والتواصل</h3><div className="rx-design-fields">{([
          ['doctorTitle','لقب الطبيب'], ['doctorName','اسم الطبيب بالعربي'], ['doctorEnglish','اسم الطبيب بالإنجليزي'], ['specialty1','التخصص الأول'], ['specialty2','التخصص الثاني'], ['phone','هاتف العيادة'], ['address','عنوان العيادة'],
        ] as const).map(([key, label]) => <label key={key}>{label}<input aria-label={label + ' في تصميم الروشتة'} value={draft.header[key]} maxLength={500} onChange={e => header(key, e.target.value)} dir={key === 'phone' || key === 'doctorEnglish' ? 'ltr' : 'auto'}/></label>)}</div></section>
        <section className="rx-design-card"><h3>٢. الألوان والخط</h3><div className="rx-design-fields">{([
          ['primaryColor','لون العناوين والشريط'], ['headerColor','لون بطاقة الطبيب'], ['accentColor','لون الحدود والتفاصيل'],
        ] as const).map(([key,label]) => <label key={key}>{label}<span className="rx-design-color"><input aria-label={label} type="color" value={draft.design[key]} onChange={e => design(key,e.target.value)}/><bdi>{draft.design[key]}</bdi></span></label>)}
        <label>نوع الخط<select aria-label="نوع خط الروشتة" value={draft.design.fontFamily} onChange={e=>design('fontFamily',e.target.value as 'Arial'|'Tahoma')}><option value="Arial">Arial — واضح ومتوازن</option><option value="Tahoma">Tahoma — عربي واضح</option></select></label>
        <label>حجم الخط<select aria-label="حجم خط الروشتة" value={draft.design.fontSize} onChange={e=>design('fontSize',Number(e.target.value) as 12|13|14)}><option value="12">قياسي</option><option value="13">أكبر قليلًا</option><option value="14">كبير وواضح</option></select></label></div></section>
        <section className="rx-design-card"><h3>٣. ترتيب الورقة</h3><div className="rx-design-fields">
          <label>مكان الشعار<select aria-label="مكان شعار الروشتة" value={draft.design.logoPosition} onChange={e=>design('logoPosition',e.target.value as 'left'|'right')}><option value="left">يسار بيانات الطبيب</option><option value="right">يمين بيانات الطبيب</option></select></label>
          <label>بطاقة الطبيب<select aria-label="شكل بطاقة الطبيب" value={draft.design.headerStyle} onChange={e=>design('headerStyle',e.target.value as 'filled'|'outline')}><option value="filled">خلفية ملونة</option><option value="outline">إطار هادئ</option></select></label>
          <label>المسافة بين الأدوية<select aria-label="مسافة أدوية الروشتة" value={draft.design.spacing} onChange={e=>design('spacing',e.target.value as 'comfortable'|'compact')}><option value="comfortable">مريحة</option><option value="compact">مختصرة</option></select></label>
        </div><div className="rx-design-toggles">{([['showLogo','إظهار شعار العيادة'],['showWatermark','العلامة المائية الخفيفة'],['showFileNo','إظهار رقم الملف']] as const).map(([key,label])=><label key={key}><input type="checkbox" checked={draft.design[key]} onChange={e=>design(key,e.target.checked)}/>{label}</label>)}</div>
        <label>عبارة أسفل الورقة (اختياري)<textarea aria-label="عبارة أسفل الروشتة" maxLength={300} rows={2} value={draft.design.footerNote} onChange={e=>design('footerNote',e.target.value)}/></label><p>ورق A5 ثابت لوضوح الطباعة والصورة. الشعار يُعدّل من «الهوية والمظهر». لا تُقبل أكواد أو خطوط خارجية في هذا المحرر.</p></section>
        <div className="rx-design-actions"><button type="submit" disabled={!dirty||conflict||saving}><Save aria-hidden="true"/>{saving?'جارٍ الحفظ…':'حفظ تصميم الروشتة'}</button><button type="button" disabled={!dirty||saving} onClick={()=>askConfirm({title:'استرجاع التصميم المحفوظ؟',message:'سيتم تجاهل تعديلات التصميم غير المحفوظة فقط؛ لا تتغير أي روشتة أو بيانات مريض.',confirmLabel:'استرجاع المحفوظ',onConfirm:resetSaved})}><RotateCcw aria-hidden="true"/>استرجاع المحفوظ</button></div>
      </fieldset></form>
      <aside className="rx-design-preview"><h3>معاينة نفس ورقة الطباعة</h3><p>بيانات توضيحية للعرض فقط، لا تُنشئ مريضًا أو روشتة.</p><PrescriptionPaperPreview data={{clinicName,clinicLogo,...draft.header,specialties:[draft.header.specialty1,draft.header.specialty2],patientName:'اسم المريض للمعاينة فقط',fileNo:'—',age:30,date:localDateISO(),diagnosis:'',items:[{id:'preview-only',drugName:'اسم الدواء / Medicine name',dosage:'الجرعة حسب ما يكتبه الطبيب',duration:'المدة المحددة'}],notes:'تظهر تعليمات الطبيب هنا عند كتابتها.',design:draft.design}}/></aside>
    </div>
  </section>;
}
