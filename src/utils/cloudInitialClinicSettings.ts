import { parseCloudClinicSettingsData, type CloudClinicSettingsData } from './cloudClinicSettingsRepository';

/** Initial metadata only for a trusted EMPTY-clinic bootstrap, never fallback
 * after a failed cloud read or a browser-data migration. No patient, account,
 * drug, laboratory tariff or treatment price is invented. The owner explicitly
 * approved the examination price in the separate authoritative service catalog. */
export function createCloudInitialClinicSettings(): CloudClinicSettingsData {
  return parseCloudClinicSettingsData({
    identity: { clinicName: 'عيادة الأسنان', doctorName: '', phone: '', address: '', logoRecordId: null },
    theme: { primary: '#2563eb', secondary: '#0f172a', accent: '#14b8a6', background: '#f8fafc',
      fontFamily: 'Cairo, Arial, sans-serif', customFontUrl: null },
    content: { homeSubtitle: '', welcomeText: '',
      tiles: { patients: { title: 'ملفات المرضى', desc: 'الملفات والجلسات والحسابات' },
        contacts: { title: 'جهات الاتصال', desc: 'دليل موحد للأرقام وأرقام الملفات' },
        appointments: { title: 'المواعيد', desc: 'الحجز والحضور والمتابعة' },
        lab: { title: 'التركيبات والمعامل', desc: 'حالات التركيبات وحسابات المعامل' },
        summary: { title: 'الماليات', desc: 'التحصيل والمصروفات والخامات' },
        settings: { title: 'لوحة التحكم', desc: 'إعدادات العيادة والخدمات والأسعار' } },
      tabs: { info: 'البيانات', chart: 'الأسنان', sessions: 'الجلسات', finance: 'الحساب', lab: 'التركيبات' },
      navigationLabels: { home: 'الرئيسية', patients: 'المرضى', contacts: 'جهات الاتصال', appointments: 'المواعيد',
        lab: 'التركيبات', summary: 'الماليات', settings: 'الإعدادات' },
      mobile: { order: ['patients', 'appointments', 'contacts', 'lab', 'summary', 'settings'], size: 'comfortable',
        showLabels: true, visibleCount: 4, moreSections: ['lab', 'summary', 'settings'] },
      desktop: { order: ['patients', 'appointments', 'contacts', 'lab', 'summary', 'settings'], size: 'large', showLabels: true },
      homeLayout: { sectionOrder: ['actions', 'metrics', 'schedule', 'followUp'], hiddenSections: [], density: 'compact', appointmentLimit: 6 } },
    medications: [],
    whatsapp: { senderNumber: '', autoConfirmOnAppt: false, autoRemind24h: false, autoPostOpOnAttended: false,
      templates: [
        { templateId: '10000000-0000-4000-8000-000000000101', key: 'newAppt', title: 'تأكيد الموعد',
          text: 'أهلًا {patientName} 🌷\nنؤكد موعدك في {clinicName} يوم {date} الساعة {time}. يسعدنا حضورك، ولو تحتاج تغيير الموعد تواصل معنا.' },
        { templateId: '10000000-0000-4000-8000-000000000102', key: 'reminderTomorrow', title: 'تذكير بالموعد',
          text: 'أهلًا {patientName} 🌷\nتذكير بموعدك في {clinicName} يوم {date} الساعة {time}. نتمنى لك يومًا جميلًا.' },
        { templateId: '10000000-0000-4000-8000-000000000103', key: 'accountBalance', title: 'متابعة الحساب',
          text: 'أهلًا {patientName} 🌷\nالمبلغ المتبقي في ملفك لدى {clinicName}: {remainingBalance}. لأي استفسار يسعدنا تواصلك معنا.' },
        { templateId: '10000000-0000-4000-8000-000000000104', key: 'greeting', title: 'تهنئة',
          text: 'كل عام وأنت بخير {patientName} 🌷\nأسرة {clinicName} تتمنى لك ولأحبابك أيامًا سعيدة وابتسامة جميلة دائمًا.' },
      ] },
  });
}
