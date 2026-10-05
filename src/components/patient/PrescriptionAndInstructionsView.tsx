import React, { useState } from 'react';
import { Patient, DrugCatalogItem, PrescriptionItem } from '../../types';
import { Printer, Copy, MessageCircle, Plus, Trash2, FileText, Phone, MapPin, Edit3, Settings, Sparkles } from 'lucide-react';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { cleanEgyptianPhone, getWhatsAppUrl } from '../../utils/whatsappUtils';

interface PrescriptionAndInstructionsViewProps {
  patient: Patient;
  clinicName: string;
  clinicLogo: string | null;
  drugCatalog: DrugCatalogItem[];
  canSendWhatsApp?: boolean;
}

export const PrescriptionAndInstructionsView: React.FC<PrescriptionAndInstructionsViewProps> = ({
  patient,
  clinicName,
  clinicLogo,
  drugCatalog,
  canSendWhatsApp = true
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
    if (!canSendWhatsApp) return;
    if (!/^[1-9]\d{7,14}$/.test(cleanEgyptianPhone(patient.mobile))) {
      showToast('راجع رقم هاتف المريض قبل فتح واتساب', 'warning');
      return;
    }
    window.open(getWhatsAppUrl(patient.mobile, text), '_blank', 'noopener,noreferrer');
  };

  const handleSendWhatsAppInstruction = () => {
    if (!selectedInstruction.trim()) { showToast('اكتب التعليمات أولًا', 'warning'); return; }
    openWhatsApp(`أهلاً ${patient.name}، نتمنى لك الشفاء العاجل. إليك تعليمات الطبيب:\n\n${selectedInstruction}\n\nمع تحيات ${clinicName}`);
  };

  const handleSendPrescription = () => {
    if (!rxItems.length) { showToast('أضف الأدوية إلى الروشتة أولًا', 'warning'); return; }
    const medicines = rxItems.map((item, index) => `${index + 1}. ${item.drugName}\n${item.dosage}${item.duration ? ` — ${item.duration}` : ''}`).join('\n\n');
    openWhatsApp(`أهلاً ${patient.name}، هذه الروشتة التي أعدّها لك الطبيب:\n\n${medicines}${doctorNotes.trim() ? `\n\nإرشادات الطبيب: ${doctorNotes.trim()}` : ''}\n\nمع تحيات ${clinicName}`);
  };

  // Print Prescription Window
  const handlePrintPrescription = () => {
    window.print();
  };

  const todayDateStr = new Date().toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  });

  return (
    <div className="space-y-6 font-['Cairo',sans-serif] dir-rtl">
      
      {/* Sub Tabs Toggle */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3 flex-wrap gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('prescription')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              subTab === 'prescription'
                ? 'bg-[#1a4388] text-white shadow-xs'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            الروشتة الطبية
          </button>
          <button
            type="button"
            onClick={() => setSubTab('instructions')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              subTab === 'instructions'
                ? 'bg-[#1a4388] text-white shadow-xs'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            تعليمات بعد العلاج
          </button>
        </div>

        {subTab === 'prescription' && (
          <button
            type="button"
            onClick={() => setIsTemplateEditorOpen(!isTemplateEditorOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 text-xs font-bold border border-slate-200 transition-all cursor-pointer"
          >
            <Edit3 className="w-3.5 h-3.5 text-indigo-600" />
            <span>تعديل بيانات الروشتة (اسم الطبيب والفرع)</span>
          </button>
        )}
      </div>

      {/* Template Data Editor Drawer */}
      {isTemplateEditorOpen && subTab === 'prescription' && (
        <div className="bg-indigo-50/70 border border-indigo-200 rounded-3xl p-4 sm:p-5 space-y-4 animate-fadeIn text-xs">
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
                value={rxDocTitle}
                onChange={e => setRxDocTitle(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-bold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">اسم الطبيب (بالعربي):</label>
              <input
                type="text"
                value={rxDocName}
                onChange={e => setRxDocName(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-bold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">اسم الطبيب (بالإنجليزي):</label>
              <input
                type="text"
                value={rxDocEnglish}
                onChange={e => setRxDocEnglish(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-bold font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">التخصص الأول:</label>
              <input
                type="text"
                value={rxSpecialty1}
                onChange={e => setRxSpecialty1(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-bold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">التخصص الثاني:</label>
              <input
                type="text"
                value={rxSpecialty2}
                onChange={e => setRxSpecialty2(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-bold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">رقم الهاتف والتواصل:</label>
              <input
                type="text"
                value={rxPhone}
                onChange={e => setRxPhone(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-bold font-mono"
              />
            </div>
            <div className="sm:col-span-2 md:col-span-3">
              <label className="block text-[11px] font-bold text-slate-700 mb-1">عنوان العيادة والمقر:</label>
              <input
                type="text"
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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Form: Catalog + Inputs (6 Cols) */}
          <div className="lg:col-span-6 space-y-5">
            {/* Catalog Quick Add Deck */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 space-y-3 shadow-2xs">
              <h3 className="text-xs font-bold text-slate-800 font-tajawal flex flex-wrap items-center justify-between gap-2">
                <span>فهرس الأدوية</span>
                <span className="text-[11px] text-slate-500 font-normal">اختر الدواء، ثم راجع الجرعة والمدة</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {drugCatalog.map(drug => (
                  <button
                    key={drug.id}
                    type="button"
                    onClick={() => handleAddCatalogDrug(drug)}
                    className="p-2.5 rounded-2xl bg-slate-50 hover:bg-indigo-50/80 border border-slate-200 hover:border-indigo-300 text-right transition-all cursor-pointer group flex items-start justify-between gap-2"
                  >
                    <div>
                      <span className="font-bold text-slate-900 group-hover:text-indigo-900 text-xs block">
                        {drug.name}
                      </span>
                      <span className="text-[11px] text-slate-500 block">{drug.defaultDosage}</span>
                    </div>
                    <Plus className="w-4 h-4 text-indigo-600 opacity-60 group-hover:opacity-100 shrink-0 mt-1" />
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Drug Input Form */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 space-y-4 shadow-2xs">
              <h3 className="text-xs font-bold text-slate-800 font-tajawal">
                إضافة دواء أو مستحضر مخصص
              </h3>

              <form onSubmit={handleAddCustomDrug} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">اسم الدواء والتركيز</label>
                  <input
                    type="text"
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
            </div>

            {/* Diagnosis & Extra Notes */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 space-y-3 shadow-2xs">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">التشخيص الطبي (اختياري)</label>
                <input
                  type="text"
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
                  value={doctorNotes}
                  onChange={e => setDoctorNotes(e.target.value)}
                  placeholder="مثال: يرجى الراحة التامة وعدم تناول المشروبات الساخنة..."
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:outline-none focus:border-[#1a4388]"
                />
              </div>
            </div>
          </div>

          {/* Right Live Printable A5 Prescription Preview (6 Cols) */}
          <div className="lg:col-span-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-800 font-tajawal flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-[#1a4388]" />
                معاينة الروشتة (A5)
              </h3>

              <div className="flex flex-wrap gap-2">
              {canSendWhatsApp && <button type="button" onClick={handleSendPrescription} className="flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-bold"><MessageCircle className="w-4 h-4" />فتح الروشتة في واتساب</button>}
              <button
                type="button"
                onClick={handlePrintPrescription}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md cursor-pointer transition-all active:scale-95"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة الروشتة (A5)</span>
              </button>
              </div>
            </div>

            {/* Printable Paper Canvas (A5 Ratio: 1 : 1.414) */}
            <div id="printable-prescription-wrapper" className="w-full min-w-0">
              <div 
                id="printable-prescription" 
                className="bg-white rounded-2xl p-3 sm:p-5 border border-slate-200 shadow-sm text-slate-900 font-tajawal relative min-h-[620px] flex flex-col justify-between min-w-0"
              >
                
                {/* 1. TOP HEADER BANNER (EXACT DR. MOHAMED OSAMA STYLE) */}
                <div className="flex flex-col sm:flex-row items-stretch justify-between gap-2 rounded-2xl">
                  
                  {/* LEFT: Tooth Logo + English Name */}
                  <div className="flex items-center gap-2.5 p-2 pl-3 min-w-0">
                    <div className="relative w-12 h-12 shrink-0 flex items-center justify-center">
                      {clinicLogo ? <img src={clinicLogo} alt={clinicName} className="h-12 w-12 object-contain" /> : <svg className="w-12 h-12" viewBox="0 0 100 100" fill="none">
                        <path
                          d="M25 20 C35 10, 45 22, 50 25 C55 22, 65 10, 75 20 C85 30, 85 50, 80 65 C76 77, 65 92, 58 92 C54 92, 53 82, 50 82 C47 82, 46 92, 42 92 C35 92, 24 77, 20 65 C15 50, 15 30, 25 20 Z"
                          stroke="#1a4388"
                          strokeWidth="6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                        <path
                          d="M32 35 L42 75 L50 48 L58 75 L68 35"
                          stroke="#c59d5f"
                          strokeWidth="5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      </svg>}
                    </div>

                    <div className="min-w-0 font-sans text-left">
                      <span dir="ltr" className="block font-bold text-sm text-[#1a4388] break-words">{rxDocEnglish}</span>
                    </div>
                  </div>

                  {/* RIGHT: Royal Blue Banner Box */}
                  <div className="bg-[#1a4388] text-white p-3.5 px-4 rounded-2xl text-right flex flex-col justify-center min-w-0 flex-1 shadow-sm">
                    <span className="text-[11px] font-bold text-slate-200 leading-tight block">
                      {rxDocTitle}
                    </span>
                    <h2 className="text-base sm:text-lg font-black tracking-tight leading-tight font-tajawal">
                      {rxDocName}
                    </h2>
                    <p className="text-[11px] font-bold text-slate-100 mt-0.5 leading-tight">
                      {rxSpecialty1}
                    </p>
                    <p className="text-[10px] font-semibold text-slate-200 leading-tight">
                      {rxSpecialty2}
                    </p>
                  </div>

                </div>

                {/* 2. PATIENT INFO STRIP (GOLD PILL BORDER) */}
                <div className="mt-3 border border-[#c59d5f] rounded-xl px-3 py-2 grid grid-cols-2 gap-2 text-[11px] font-black text-[#1a4388] bg-amber-50/30">
                  <div className="text-right col-span-2 break-words">
                    <span className="text-[#1a4388] font-black">الاسم: </span>
                    <span className="text-slate-900 font-bold">{patient.name}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[#1a4388] font-black">السن: </span>
                    <span className="text-slate-900 font-bold">{patient.age} سنة</span>
                  </div>
                  <div className="text-left font-mono">
                    <span className="text-[#1a4388] font-black">التاريخ: </span>
                    <span className="text-slate-900 font-bold">{todayDateStr}</span>
                  </div>
                </div>

                {/* 3. MAIN RX BODY & WATERMARK */}
                <div className="relative flex-1 my-3 flex flex-col justify-between min-h-[280px]">
                  
                  {/* Central Tooth Watermark Background */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center opacity-8 pointer-events-none select-none z-0">
                    <svg className="w-48 h-48 text-[#1a4388]" viewBox="0 0 100 100" fill="none">
                      <path
                        d="M25 20 C35 10, 45 22, 50 25 C55 22, 65 10, 75 20 C85 30, 85 50, 80 65 C76 77, 65 92, 58 92 C54 92, 53 82, 50 82 C47 82, 46 92, 42 92 C35 92, 24 77, 20 65 C15 50, 15 30, 25 20 Z"
                        stroke="currentColor"
                        strokeWidth="3"
                        fill="none"
                      />
                      <path
                        d="M32 35 L42 75 L50 48 L58 75 L68 35"
                        stroke="#c59d5f"
                        strokeWidth="3"
                        fill="none"
                      />
                    </svg>
                    <span className="font-serif font-bold text-xs text-[#1a4388] mt-1 tracking-widest uppercase">
                      {rxDocEnglish} Dental Clinic
                    </span>
                  </div>

                  {/* Top Left Rx Symbol */}
                  <div className="relative z-10 text-3xl font-serif font-black text-[#1a4388] dir-ltr text-left pl-2 pt-1">
                    ℞
                  </div>

                  {/* Rx Items List */}
                  <div className="relative z-10 flex-1 space-y-2.5 px-2">
                    {rxItems.length === 0 ? (
                      <div className="text-center py-12 text-slate-400 text-xs italic">
                        لم يتم إضافة أية أدوية بعد. اختر من الفهرس أو أضف دواء مخصص.
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {rxItems.map((item, idx) => (
                          <div
                            key={item.id}
                            className="p-2.5 bg-slate-50/90 rounded-2xl border border-slate-200/90 flex items-start justify-between gap-3 text-xs group transition-all"
                          >
                            <div className="space-y-0.5">
                              <div className="font-black text-slate-900 text-sm font-sans">
                                <span className="text-[#1a4388] font-bold ml-1">{idx + 1}.</span> {item.drugName}
                              </div>
                              <div className="text-slate-800 font-bold text-[11px] pr-3 flex items-center gap-1">
                                <span className="text-[#1a4388]">◄</span>
                                <span>{item.dosage}</span>
                                {item.duration && (
                                  <span className="text-slate-500 font-semibold">({item.duration})</span>
                                )}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleRemoveRxItem(item.id)}
                              className="text-rose-500 hover:text-rose-700 p-1 opacity-80 group-hover:opacity-100 cursor-pointer print:hidden"
                              title="حذف الدواء"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {diagnosis && (
                      <div className="p-2 px-3 bg-indigo-50/80 border border-indigo-200/80 rounded-xl text-[11px] text-indigo-950 font-bold">
                        <span className="text-indigo-800 font-black">التشخيص: </span> {diagnosis}
                      </div>
                    )}

                    {doctorNotes && (
                      <div className="p-2 px-3 bg-amber-50/90 border border-amber-200 rounded-xl text-[11px] text-amber-950 font-bold">
                        <span className="text-amber-800 font-black">إرشادات الطبيب: </span> {doctorNotes}
                      </div>
                    )}
                  </div>

                </div>

                {/* 4. FOOTER SECTION (QR CODE + PHONE & ADDRESS BAR) */}
                <div className="mt-2 space-y-2">
                  
                  {/* QR Code Row */}
                  <div className="flex items-end justify-between px-1">
                    <span className="text-xs font-bold text-[#1a4388] break-words">{clinicName}</span>

                    <div className="text-left font-sans text-[10px] text-slate-400 font-semibold">
                      ملف #{patient.id}
                    </div>
                  </div>

                  {/* Dark Blue Footer Banner (Exact Dr. Mohamed Osama Style) */}
                  <div className="bg-[#1a4388] text-white rounded-2xl p-2.5 px-4 flex flex-col sm:flex-row items-center justify-between gap-1.5 text-center sm:text-right shadow-sm">
                    {/* Phone / WhatsApp */}
                    <div className="flex items-center gap-1.5 font-mono text-xs sm:text-sm font-black dir-ltr">
                      <span className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
                        <Phone className="w-3 h-3 fill-current" />
                      </span>
                      <span className="tracking-wider">{rxPhone}</span>
                    </div>

                    {/* Location Pin & Address */}
                    <div className="flex items-start gap-1 text-[10px] sm:text-[11px] font-bold text-slate-100 min-w-0">
                      <MapPin className="w-3.5 h-3.5 text-rose-300 shrink-0" />
                      <span className="break-words">{rxAddress}</span>
                    </div>
                  </div>

                </div>

              </div>
            </div>

          </div>
        </div>
      )}

      {/* 2. Instructions Section */}
      {subTab === 'instructions' && (
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-6">
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

              {canSendWhatsApp && <button
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

