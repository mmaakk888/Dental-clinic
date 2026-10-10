import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Patient, DrugCatalogItem, PrescriptionItem } from '../../types';
import { Printer, Copy, MessageCircle, Plus, Trash2, FileText, Edit3, Settings, Search, ImageDown, Share2 } from 'lucide-react';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { cleanEgyptianPhone, getWhatsAppUrl } from '../../utils/whatsappUtils';
import { downloadAuthorizedImage, printAuthorizedDocument, requireAuthorizedDataOutput } from '../../utils/authorizedDataOutput';
import { renderPrescriptionImage, sharePrescriptionImage } from '../../utils/prescriptionImage';
import { filterDrugCatalog } from '../../utils/drugCatalog';
import { createPrescriptionDocument } from './PrescriptionDocument';
import './patientClinicalTools.css';

interface PrescriptionAndInstructionsViewProps {
  patient: Patient;
  clinicName: string;
  clinicLogo: string | null;
  drugCatalog: DrugCatalogItem[];
  canSendWhatsApp?: boolean;
  canPrint?: boolean;
  onAuthorizePrint?: () => void;
  onAuthorizeWhatsappSend?: (request: { isCampaign: boolean; requiresFinance: boolean }) => void;
}

export const PrescriptionAndInstructionsView: React.FC<PrescriptionAndInstructionsViewProps> = ({
  patient,
  clinicName,
  clinicLogo,
  drugCatalog,
  canSendWhatsApp = true,
  canPrint = false,
  onAuthorizePrint,
  onAuthorizeWhatsappSend,
}) => {
  const { showToast } = useToastAndConfirm();

  // Active Tab: Prescription or Post-Op
  const [subTab, setSubTab] = useState<'prescription' | 'instructions'>('prescription');

  // Prescription Form State
  const [diagnosis, setDiagnosis] = useState('');
  const [rxItems, setRxItems] = useState<PrescriptionItem[]>([]);
  const [customDrugName, setCustomDrugName] = useState('');
  const [customDosage, setCustomDosage] = useState('');
  const [customDuration, setCustomDuration] = useState('');
  const [doctorNotes, setDoctorNotes] = useState('');
  const [drugQuery, setDrugQuery] = useState('');
  const deferredDrugQuery = useDeferredValue(drugQuery);
  const [catalogLimit, setCatalogLimit] = useState(12);
  const matchingDrugs = useMemo(() => filterDrugCatalog(drugCatalog, { query: deferredDrugQuery }), [drugCatalog, deferredDrugQuery]);

  // Prescription Header/Footer Customizable Template Data (Defaults match Dr. Mohamed Osama A5 design)
  const [rxDocTitle, setRxDocTitle] = useState('دكتور');
  const [rxDocName, setRxDocName] = useState('محمد أسامة عبدالكريم');
  const [rxDocEnglish, setRxDocEnglish] = useState('DR. MOHAMED OSAMA');
  const [rxSpecialty1, setRxSpecialty1] = useState('طب وجراحة الفم والأسنان');
  const [rxSpecialty2, setRxSpecialty2] = useState('تقويم وتجميل الأسنان');
  const [rxPhone, setRxPhone] = useState('011 4338 4338');
  const [rxAddress, setRxAddress] = useState('طريق اجا السنبلاوين - برج النور الحمص - بجوار الجمعية الزراعية');
  const [isTemplateEditorOpen, setIsTemplateEditorOpen] = useState(false);

  // Post-Op Instruction Templates
  const postOpTemplates = [
    {
      id: 'ext',
      title: 'تعليمات ما بعد الخلع الجراحي أو العادي',
      content: `1. الضغط المباشر على الشاش فوق موضع الخلع لمدة ساعة كاملة وعدم التحدث.
2. البصق المستمر ممنوع نهائياً؛ بل يجب بلع الريق طبيعياً.
3. تجنب المأكولات والمشروبات الساخنة والتدخين لمدة 24 ساعة.
4. عدم المضمضة بالماء والملح إلا بعد مرور 24 ساعة من الخلع.
5. المأكولات تكون لينة وباردة وعلى الجانب الآخر من الفم.`
    },
    {
      id: 'endo',
      title: 'تعليمات ما بعد علاج الجذور والحشوات',
      content: `1. تجنب الأكل على السن التي بها حشو حتى زوال مفعول التخدير (البنج) تماماً.
2. من الطبيعي الشعور بألم خفيف عند العض على السن لمدة 2-3 أيام بعد جلسة العصب.
3. الالتزام بالمسكن والمضاد الحيوي الموصوف من الطبيب في مواعيده.
4. تجنب تناول المأكولات الصلبة كالمكسرات على الحشو الموقت حتى جفاف الحشوة.`
    },
    {
      id: 'white',
      title: 'تعليمات ما بعد تبييض وتنظيف الأسنان',
      content: `1. تجنب تناول الأطعمة والمشروبات الملونة (الشاى، القهوة، المشروبات الغازية، الصويا) لمدة 48 ساعة.
2. الامتناع عن التدخين تماماً خلال الـ 48 ساعة الأولى بعد التبييض.
3. في حالة حساسية الأسنان المؤقتة، يُنصح باستخدام معجون أسنان مخصص للحساسية.`
    }
  ];

  const [selectedInstruction, setSelectedInstruction] = useState(postOpTemplates[0].content);

  // Quick Add from catalog
  const handleAddCatalogDrug = (drug: DrugCatalogItem) => {
    const newItem: PrescriptionItem = {
      id: crypto.randomUUID(),
      drugName: drug.name,
      dosage: drug.defaultDosage,
      duration: drug.defaultDuration
    };
    setRxItems(prev => [...prev, newItem]);
    showToast(`تمت إضافة (${drug.name}) إلى الروشتة`, 'info');
  };

  // Add custom drug
  const handleAddCustomDrug = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customDrugName.trim()) {
      showToast('اكتب اسم الدواء أولًا', 'warning');
      return;
    }

    const newItem: PrescriptionItem = {
      id: crypto.randomUUID(),
      drugName: customDrugName.trim(),
      dosage: customDosage.trim() || 'حسب إرشادات الطبيب',
      duration: customDuration.trim()
    };
    setRxItems(prev => [...prev, newItem]);
    setCustomDrugName('');
    setCustomDosage('');
    setCustomDuration('');
    showToast('تم إضافة الدواء للروشتة بنجاح', 'success');
  };

  const handleRemoveRxItem = (id: string) => {
    setRxItems(prev => prev.filter(i => i.id !== id));
  };
  const updateRxItem = (id: string, patch: Partial<Pick<PrescriptionItem, 'drugName' | 'dosage' | 'duration'>>) => {
    setRxItems(previous => previous.map(item => item.id === id ? { ...item, ...patch } : item));
  };
  const validateRxNames = () => {
    if (rxItems.some(item => !item.drugName.trim())) { showToast('راجع أسماء الأدوية قبل الطباعة أو الإرسال.', 'warning'); return false; }
    return true;
  };

  // Copy Instruction to clipboard
  const handleCopyInstruction = async () => {
    if (!selectedInstruction.trim()) { showToast('اكتب التعليمات أولًا', 'warning'); return; }
    try {
      await navigator.clipboard.writeText(selectedInstruction);
      showToast('تم نسخ التعليمات إلى الحافظة', 'success');
    } catch {
      showToast('تعذر النسخ. حدد النص وانسخه يدويًا.', 'warning');
    }
  };

  const openWhatsApp = (text: string) => {
    if (!canSendWhatsApp || !onAuthorizeWhatsappSend) return;
    if (!/^[1-9]\d{7,14}$/.test(cleanEgyptianPhone(patient.mobile))) {
      showToast('راجع رقم هاتف المريض قبل فتح واتساب', 'warning');
      return;
    }
    try {
      onAuthorizeWhatsappSend({ isCampaign: false, requiresFinance: false });
      window.open(getWhatsAppUrl(patient.mobile, text), '_blank', 'noopener,noreferrer');
    } catch { showToast('تعذّر فتح واتساب؛ راجع صلاحية الحساب والجلسة.', 'error'); }
  };

  const handleSendWhatsAppInstruction = () => {
    if (!selectedInstruction.trim()) { showToast('اكتب التعليمات أولًا', 'warning'); return; }
    openWhatsApp(`أهلاً ${patient.name}، نتمنى لك الشفاء العاجل. إليك تعليمات الطبيب:\n\n${selectedInstruction}\n\nمع تحيات ${clinicName}`);
  };

  const handleSendPrescription = () => {
    if (!rxItems.length) { showToast('أضف الأدوية إلى الروشتة أولًا', 'warning'); return; }
    if (!validateRxNames()) return;
    const medicines = rxItems.map((item, index) => `${index + 1}. ${item.drugName}\n${item.dosage}${item.duration ? ` — ${item.duration}` : ''}`).join('\n\n');
    openWhatsApp(`أهلاً ${patient.name}، هذه الروشتة التي أعدّها لك الطبيب:\n\n${medicines}${doctorNotes.trim() ? `\n\nإرشادات الطبيب: ${doctorNotes.trim()}` : ''}\n\nمع تحيات ${clinicName}`);
  };

  // Print Prescription Window
  const handlePrintPrescription = () => {
    if (!validateRxNames()) return;
    try { printAuthorizedDocument(canPrint, onAuthorizePrint); }
    catch { showToast('تعذّرت الطباعة؛ راجع صلاحية الحساب والجلسة.', 'error'); }
  };

  const todayDateStr = new Date().toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  });

  const [preparedImage, setPreparedImage] = useState<{ url: string; file: File; signature: string } | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const imagePending = useRef(false);
  const paperRef = useRef<HTMLDivElement>(null);
  const paperWrapper = useRef<HTMLDivElement>(null);
  const paperScale = useRef<HTMLDivElement>(null);
  const outputPanel = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const imageData = { clinicName, clinicLogo, doctorTitle: rxDocTitle, doctorName: rxDocName, doctorEnglish: rxDocEnglish,
    specialties: [rxSpecialty1, rxSpecialty2], phone: rxPhone, address: rxAddress, patientName: patient.name,
    fileNo: patient.id, age: patient.age, date: todayDateStr, diagnosis, items: rxItems, notes: doctorNotes };
  const imageSignature = JSON.stringify(imageData);
  useEffect(() => {
    const paper = paperRef.current, wrapper = paperWrapper.current, scaleLayer = paperScale.current;
    if (!paper || !wrapper || !scaleLayer || typeof ResizeObserver === 'undefined') return;
    const fitPaper = () => {
      const scale = Math.min(1, wrapper.clientWidth / paper.offsetWidth);
      if (!(scale > 0)) return;
      scaleLayer.style.transform = `scale(${scale})`;
      wrapper.style.height = `${Math.ceil(paper.offsetHeight * scale)}px`;
    };
    const observer = new ResizeObserver(fitPaper);
    observer.observe(paper); observer.observe(wrapper); fitPaper();
    return () => observer.disconnect();
  }, [subTab]);
  const latestImage = useRef({ imageSignature, canPrint, onAuthorizePrint });
  latestImage.current = { imageSignature, canPrint, onAuthorizePrint };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setPreparedImage(null); }, [imageSignature, canPrint]);
  useEffect(() => () => { if (preparedImage) URL.revokeObjectURL(preparedImage.url); }, [preparedImage]);
  const currentImage = preparedImage?.signature === imageSignature && canPrint ? preparedImage : null;
  const prepareImage = async () => {
    if (imagePending.current || !validateRxNames()) return;
    imagePending.current = true; setImageBusy(true);
    const signature = imageSignature;
    try {
      const blob = await renderPrescriptionImage(imageData, canPrint, onAuthorizePrint, paperRef.current);
      const latest = latestImage.current;
      requireAuthorizedDataOutput(latest.canPrint, latest.onAuthorizePrint);
      if (!mounted.current || latest.imageSignature !== signature) return;
      const file = new File([blob], `prescription-${patient.id.replace(/[^\w-]/g, '').slice(0, 40) || 'patient'}.png`, { type: 'image/png' });
      setPreparedImage({ file, url: URL.createObjectURL(blob), signature });
      showToast('الصورة جاهزة للمراجعة والتنزيل أو المشاركة.', 'info');
    } catch (error) { if (mounted.current) showToast(error instanceof Error ? error.message : 'تعذّر تجهيز صورة الروشتة.', 'error'); }
    finally { imagePending.current = false; if (mounted.current) setImageBusy(false); }
  };
  const downloadImage = () => {
    if (!currentImage) return;
    try { downloadAuthorizedImage(currentImage.url, currentImage.file.name, canPrint, onAuthorizePrint); }
    catch { showToast('تعذّر التنزيل؛ راجع صلاحية الحساب والجلسة.', 'error'); }
  };
  const shareImage = async () => {
    if (!currentImage || imagePending.current || !canSendWhatsApp || !onAuthorizeWhatsappSend) return;
    imagePending.current = true; setImageBusy(true);
    try {
      onAuthorizeWhatsappSend({ isCampaign: false, requiresFinance: false });
      const result = await sharePrescriptionImage(currentImage.file, canPrint, onAuthorizePrint);
      if (result === 'unsupported') showToast('مشاركة الملفات غير مدعومة هنا. اضغط «تنزيل الصورة»، ثم أرفقها في محادثة المريض على واتساب.', 'info', { duration: 9000 });
      // A resolved native share is not proof of delivery to the patient.
    } catch (error) { showToast(error instanceof Error ? error.message : 'تعذّرت مشاركة الصورة.', 'error'); }
    finally { imagePending.current = false; if (mounted.current) setImageBusy(false); }
  };

  return (
    <div className="rx-workspace font-['Cairo',sans-serif] dir-rtl" dir="rtl">
      
      {/* Sub Tabs Toggle */}
      <div className="rx-workspace-toolbar print:hidden">
        <div className="rx-workspace-tabs" role="group" aria-label="الروشتة وتعليمات العلاج">
          <button
            type="button"
            onClick={() => setSubTab('prescription')}
            aria-pressed={subTab === 'prescription'}
          >
            الروشتة الطبية
          </button>
          <button
            type="button"
            onClick={() => setSubTab('instructions')}
            aria-pressed={subTab === 'instructions'}
          >
            تعليمات بعد العلاج
          </button>
        </div>

        {subTab === 'prescription' && (
          <div className="rx-toolbar-actions">
          {canPrint && onAuthorizePrint && <button type="button" className="rx-secondary-button" onClick={() => { outputPanel.current?.scrollIntoView({ block: 'start', behavior: 'auto' }); outputPanel.current?.focus({ preventScroll: true }); }}><ImageDown aria-hidden="true" />صورة الروشتة والطباعة</button>}
          <button
            type="button"
            onClick={() => setIsTemplateEditorOpen(!isTemplateEditorOpen)}
            aria-expanded={isTemplateEditorOpen} aria-controls="rx-template-editor"
            className="rx-secondary-button"
          >
            <Edit3 className="w-3.5 h-3.5 text-indigo-600" />
            <span>بيانات ورقة الروشتة</span>
          </button>
          </div>
        )}
      </div>

      {/* Template Data Editor Drawer */}
      {isTemplateEditorOpen && subTab === 'prescription' && (
        <div id="rx-template-editor" className="rx-template-editor rx-card print:hidden">
          <div className="flex items-center justify-between pb-2 border-b border-indigo-100">
            <h4 className="font-extrabold text-indigo-950 font-tajawal flex items-center gap-2">
              <Settings className="w-4 h-4 text-indigo-600" />
              بيانات الطبيب والعيادة
            </h4>
            <button
              type="button"
              onClick={() => setIsTemplateEditorOpen(false)}
              className="text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
            >
              إغلاق ✕
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">لقب الطبيب:</label>
              <input
                type="text"
                aria-label="لقب الطبيب"
                value={rxDocTitle}
                onChange={e => setRxDocTitle(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-bold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">اسم الطبيب (بالعربي):</label>
              <input
                type="text"
                aria-label="اسم الطبيب بالعربي"
                value={rxDocName}
                onChange={e => setRxDocName(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-bold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">اسم الطبيب (بالإنجليزي):</label>
              <input
                type="text"
                aria-label="اسم الطبيب بالإنجليزي"
                value={rxDocEnglish}
                onChange={e => setRxDocEnglish(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-bold font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">التخصص الأول:</label>
              <input
                type="text"
                aria-label="التخصص الأول"
                value={rxSpecialty1}
                onChange={e => setRxSpecialty1(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-bold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">التخصص الثاني:</label>
              <input
                type="text"
                aria-label="التخصص الثاني"
                value={rxSpecialty2}
                onChange={e => setRxSpecialty2(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-bold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">رقم الهاتف والتواصل:</label>
              <input
                type="text"
                aria-label="هاتف العيادة في الروشتة"
                value={rxPhone}
                onChange={e => setRxPhone(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-bold font-mono"
              />
            </div>
            <div className="sm:col-span-2 md:col-span-3">
              <label className="block text-[11px] font-bold text-slate-700 mb-1">عنوان العيادة والمقر:</label>
              <input
                type="text"
                aria-label="عنوان العيادة في الروشتة"
                value={rxAddress}
                onChange={e => setRxAddress(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-bold"
              />
            </div>
          </div>
        </div>
      )}

      {/* 1. Prescription Section */}
      {subTab === 'prescription' && (
        <div className="rx-layout">
          
          {/* Left Form: Catalog + Inputs (6 Cols) */}
          <div className="rx-composer print:hidden">
            <p className="rx-draft-note">أضف الأدوية وراجع الجرعات، ثم جهّز صورة الروشتة من المعاينة لمشاركتها في واتساب بنفس ورقة الطباعة.</p>
            {/* Catalog Quick Add Deck */}
            <section className="rx-card" aria-label="اختيار دواء من الفهرس">
              <h3 className="rx-card-heading">
                <span>فهرس الأدوية</span>
                <span className="text-[11px] text-slate-500 font-normal">اختر الدواء، ثم راجع الجرعة والمدة</span>
              </h3>
              <label className="rx-catalog-search"><Search aria-hidden="true" /><input type="search" aria-label="بحث في فهرس الأدوية" value={drugQuery} onChange={event => { setDrugQuery(event.target.value); setCatalogLimit(12); }} placeholder="ابحث باسم الدواء أو تصنيفه…" autoComplete="off" /></label>
              <div className="rx-catalog-list" aria-busy={drugQuery !== deferredDrugQuery}>
                {matchingDrugs.slice(0, catalogLimit).map(drug => (
                  <button
                    key={drug.id}
                    type="button"
                    onClick={() => handleAddCatalogDrug(drug)}
                    className="rx-catalog-drug" aria-label={`إضافة ${drug.name} إلى الروشتة`}
                  >
                    <div>
                      <span className="font-bold text-slate-900 group-hover:text-indigo-900 text-xs block">
                        {drug.name}
                      </span>
                      <span className="rx-catalog-category">{drug.category || 'دواء من الفهرس'}</span>
                    </div>
                    <Plus className="w-4 h-4 text-indigo-600 opacity-60 group-hover:opacity-100 shrink-0 mt-1" />
                  </button>
                ))}
              </div>
              {!matchingDrugs.length && <p className="rx-empty-note">{drugCatalog.length ? 'لا يوجد دواء مطابق؛ جرّب اسمًا آخر أو أضف دواءً مخصصًا.' : 'فهرس الأدوية فارغ. يمكنك إضافة دواء مخصص أدناه.'}</p>}
              {matchingDrugs.length > catalogLimit && <button type="button" className="rx-secondary-button" onClick={() => setCatalogLimit(previous => previous + 12)}>عرض أدوية أخرى ({matchingDrugs.length - catalogLimit})</button>}
            </section>

            {/* Custom Drug Input Form */}
            <details className="rx-card rx-custom-drug">
              <summary>
                إضافة دواء أو مستحضر مخصص
              </summary>

              <form onSubmit={handleAddCustomDrug} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">اسم الدواء والتركيز</label>
                  <input
                    type="text"
                    aria-label="اسم الدواء المخصص والتركيز"
                    value={customDrugName}
                    onChange={e => setCustomDrugName(e.target.value)}
                    placeholder="مثال: Augmentin 1g or Cataflam 50mg"
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:outline-none focus:border-[#1a4388]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">طريقة الجرعة (Dosage)</label>
                    <input
                      type="text"
                      aria-label="جرعة الدواء المخصص"
                      value={customDosage}
                      onChange={e => setCustomDosage(e.target.value)}
                      placeholder="مثال: قرص كل 12 ساعة بعد الأكل"
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:outline-none focus:border-[#1a4388]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">المدة (Duration)</label>
                    <input
                      type="text"
                      aria-label="مدة الدواء المخصص"
                      value={customDuration}
                      onChange={e => setCustomDuration(e.target.value)}
                      placeholder="مثال: لمدة 5 أيام"
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:outline-none focus:border-[#1a4388]"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-[#1a4388] hover:bg-[#163b78] text-white text-xs font-bold cursor-pointer transition-colors shadow-2xs"
                  >
                    + إضافة الدواء للروشتة
                  </button>
                </div>
              </form>
            </details>

            <section className="rx-card" aria-label="الأدوية المضافة للروشتة"><h3 className="rx-card-heading"><span>الأدوية المضافة</span><small>{rxItems.length} دواء</small></h3>
              {!rxItems.length ? <p className="rx-empty-note">اختر دواءً من الفهرس أو أضف دواءً مخصصًا، ثم راجع الجرعة والمدة هنا.</p> : <div className="rx-edit-list">{rxItems.map((item, index) => <div className="rx-edit-item" key={item.id}><div className="rx-edit-item-heading"><span>الدواء {index + 1}</span><button type="button" className="rx-remove-drug" aria-label={`حذف الدواء ${index + 1}`} onClick={() => handleRemoveRxItem(item.id)}><Trash2 aria-hidden="true" /></button></div><label>اسم الدواء<input aria-label={`اسم الدواء ${index + 1}`} value={item.drugName} onChange={event => updateRxItem(item.id, { drugName: event.target.value })} dir="auto" /></label><div className="rx-dose-grid"><label>الجرعة<input aria-label={`جرعة الدواء ${index + 1}`} value={item.dosage} onChange={event => updateRxItem(item.id, { dosage: event.target.value })} dir="auto" /></label><label>المدة<input aria-label={`مدة الدواء ${index + 1}`} value={item.duration} onChange={event => updateRxItem(item.id, { duration: event.target.value })} dir="auto" /></label></div></div>)}</div>}
            </section>

            {/* Diagnosis & Extra Notes */}
            <div className="rx-card rx-doctor-notes">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">التشخيص الطبي (اختياري)</label>
                <input
                  type="text"
                  aria-label="التشخيص الطبي للروشتة"
                  value={diagnosis}
                  onChange={e => setDiagnosis(e.target.value)}
                  placeholder="مثال: التهاب حاد بالعصب / خلع جراحي لضرس العقل"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:outline-none focus:border-[#1a4388]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">إرشادات إضافية للروشتة</label>
                <textarea
                  rows={2}
                  aria-label="إرشادات إضافية للروشتة"
                  value={doctorNotes}
                  onChange={e => setDoctorNotes(e.target.value)}
                  placeholder="مثال: يرجى الراحة التامة وعدم تناول المشروبات الساخنة..."
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:outline-none focus:border-[#1a4388]"
                />
              </div>
            </div>
          </div>

          {/* Right Live Printable A5 Prescription Preview (6 Cols) */}
          <div className="rx-preview-section">
            <div ref={outputPanel} tabIndex={-1} className="rx-preview-heading print:hidden" aria-label="معاينة الروشتة وخيارات الصورة والطباعة">
              <h3 className="text-sm font-bold text-slate-800 font-tajawal flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-[#1a4388]" />
                معاينة الروشتة (A5)
              </h3>

              {canPrint && onAuthorizePrint && <div className="rx-image-workflow" aria-label="إرسال الروشتة كصورة">
                <div className="rx-image-workflow-title"><ImageDown aria-hidden="true" /><div><strong>الروشتة صورة بنفس تصميم الطباعة</strong><p>١. جهّز الصورة وراجعها. ٢. شاركها في واتساب أو نزّلها وأرفقها بالمحادثة.</p></div></div>
                <button type="button" aria-label={currentImage ? (canSendWhatsApp && onAuthorizeWhatsappSend ? 'مشاركة صورة الروشتة في واتساب' : 'تنزيل صورة الروشتة') : 'تجهيز صورة الروشتة'} onClick={currentImage ? (canSendWhatsApp && onAuthorizeWhatsappSend ? shareImage : downloadImage) : prepareImage} disabled={imageBusy || !rxItems.length} className="rx-primary-button" aria-busy={imageBusy}>
                  {currentImage && canSendWhatsApp && onAuthorizeWhatsappSend ? <Share2 aria-hidden="true" /> : <ImageDown aria-hidden="true" />}
                  {imageBusy ? (currentImage ? 'جارٍ فتح المشاركة…' : 'جارٍ تجهيز الصورة…') : currentImage ? (canSendWhatsApp && onAuthorizeWhatsappSend ? 'مشاركة الصورة في واتساب' : 'تنزيل صورة الروشتة') : 'تجهيز صورة الروشتة'}
                </button>
                <small>المشاركة لا ترسل تلقائيًا: اختر واتساب ثم محادثة المريض بنفسك. قد يتطلب الكمبيوتر تنزيل الصورة وإرفاقها يدويًا.</small>
              </div>}

              <div className="rx-output-actions">
              {canPrint && onAuthorizePrint && <button
                type="button"
                onClick={handlePrintPrescription}
                className="rx-secondary-button"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة الروشتة (A5)</span>
              </button>}
              {canSendWhatsApp && onAuthorizeWhatsappSend && <details className="rx-text-alternative"><summary>خيارات الرسالة النصية</summary><button type="button" onClick={handleSendPrescription} className="rx-secondary-button"><MessageCircle aria-hidden="true" />واتساب كنص</button></details>}
              </div>
            </div>

            {currentImage && <section className="rx-image-ready print:hidden" aria-label="صورة الروشتة الجاهزة"><strong>الصورة جاهزة للمراجعة</strong><p>بعد اختيار واتساب من نافذة المشاركة، تأكد من اسم المريض قبل الإرسال. فتح المحادثة وحده لا يرفق الصورة.</p><img src={currentImage.url} alt="معاينة صورة الروشتة الجاهزة للمشاركة" /><div className="rx-output-actions"><button type="button" className="rx-secondary-button" onClick={downloadImage} disabled={imageBusy}><ImageDown aria-hidden="true" />تنزيل الصورة</button>{canSendWhatsApp && onAuthorizeWhatsappSend && <button type="button" className="rx-secondary-button" onClick={() => openWhatsApp('')}><MessageCircle aria-hidden="true" />فتح محادثة المريض</button>}</div></section>}

            <div id="printable-prescription-wrapper" ref={paperWrapper} className="rx-paper-viewport">
              <div ref={paperScale} className="rx-paper-scale">
                {createPrescriptionDocument(imageData, paperRef)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Instructions Section */}
      {subTab === 'instructions' && (
        <div className="rx-instructions rx-card print:hidden">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 font-tajawal">
                نماذج تعليمات ما بعد الإجراء والعمليات
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                اختر النموذج وراجع تعليماته، ثم افتح الرسالة في واتساب
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopyInstruction}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
              >
                <Copy className="w-4 h-4" />
                نسخ النص
              </button>

              {canSendWhatsApp && onAuthorizeWhatsappSend && <button
                type="button"
                onClick={handleSendWhatsAppInstruction}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer shadow-xs"
              >
                <MessageCircle className="w-4 h-4" />
                فتح التعليمات في واتساب
              </button>}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {postOpTemplates.map(tpl => (
              <button
                key={tpl.id}
                type="button"
                aria-pressed={selectedInstruction === tpl.content}
                onClick={() => setSelectedInstruction(tpl.content)}
                className={`p-4 rounded-2xl border text-right transition-all cursor-pointer space-y-1.5 ${
                  selectedInstruction === tpl.content
                    ? 'bg-[#1a4388] text-white border-[#1a4388] shadow-xs'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200'
                }`}
              >
                <span className="font-bold text-xs block font-tajawal">{tpl.title}</span>
                <span className="text-[11px] opacity-80 block truncate">{tpl.content.substring(0, 60)}...</span>
              </button>
            ))}
          </div>

          {/* Editable Active Instruction Box */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-800">نص التعليمات الحالي الموجه للمريض:</label>
            <textarea
              rows={8}
              aria-label="نص تعليمات العلاج للمريض"
              value={selectedInstruction}
              onChange={e => setSelectedInstruction(e.target.value)}
              className="w-full p-4 bg-slate-50 border border-slate-300 rounded-2xl text-xs font-semibold leading-relaxed text-slate-800 focus:outline-none focus:border-[#1a4388]"
            />
          </div>
        </div>
      )}
    </div>
  );
};

