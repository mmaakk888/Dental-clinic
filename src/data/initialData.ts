import { Patient, Appointment, Lab, LabCase, ThemeSettings, UILabels, User, Expense, WhatsappSettings, DrugCatalogItem } from '../types';

export const INITIAL_EXPENSES: Expense[] = [];

export const DEFAULT_WHATSAPP_SETTINGS: WhatsappSettings = {
  apiKey: '',
  webhookUrl: '',
  senderNumber: '',
  autoConfirmOnAppt: false,
  autoRemind24h: false,
  autoPostOpOnAttended: false,
  templates: {
    reminderTomorrow: 'أهلاً بك أ. {patientName}، نود تذكيرك بموعدك يوم {date} الساعة {time} في {clinicName}. يسعدنا حضورك!',
    newAppt: 'أهلاً بك أ. {patientName}، تم حجز موعد جديد لك يوم {date} الساعة {time} في {clinicName}.',
    postOp: 'أهلاً بك أ. {patientName}، نتمنى لك الشفاء العاجل! نرفق لك تعليمات الهامة بعد الجلسة:\n1) الالتزام بالأدوية في مواعيدها.\n2) تجنب المشروبات الساخنة 24 ساعة.\n3) التواصل معنا فوراً عند أي استفسار.',
    accountBalance: 'أهلاً بك أ. {patientName}، نود إحاطتك علماً بأن المتبقي على حساب ملفك برقم #{fileNo} هو {remainingBalance} ج.م. يسعدنا تواصلك معنا دائماً.'
  }
};

export const DEFAULT_DRUG_CATALOG: DrugCatalogItem[] = [];

export const DEFAULT_SERVICE_TYPES = [];

export const DEFAULT_PATIENT_CROWN_PRICES: Record<string, number> = {};

export const DEFAULT_THEME: ThemeSettings = {
  primary: '#4f46e5',
  secondary: '#4338ca',
  accent: '#6366f1',
  background: '#f8fafc',
  fontFamily: "'Cairo', sans-serif"
};

export const DEFAULT_UI_LABELS: UILabels = {
  homeSubtitle: 'إدارة ملفات المرضى ومتابعة العمل اليومي',
  welcomeText: 'أهلاً بك يا دكتور، اختر القسم المطلوب للمتابعة',
  tiles: {
    patients: { title: 'فهرس الحالات', desc: 'إدارة ملفات المرضى، السجل الطبي والمالي' },
    contacts: { title: 'جهات الاتصال', desc: 'كل أرقام العيادة، مع توضيح الأرقام المرتبطة بملفات المرضى' },
    appointments: { title: 'جدول المواعيد', desc: 'تنظيم الحجوزات اليومية والمتابعات' },
    lab: { title: 'حسابات المعمل', desc: 'متابعة أعمال التركيبات، الفواتير والأرباح' },
    summary: { title: 'الملخص المالي', desc: 'تقارير الإيرادات، التحصيل والمستحقات' },
    settings: { title: 'لوحة التحكم', desc: 'إعدادات الهوية، الخدمات، التصدير والمستخدمين' }
  },
  tabs: {
    info: 'البيانات الأساسية',
    chart: 'مخطط الأسنان',
    sessions: 'سجل الجلسات',
    finance: 'الحساب المالي',
    lab: 'حالات المعمل'
  }
};

export const DEFAULT_TILE_ORDER = ['patients', 'contacts', 'appointments', 'lab', 'summary', 'settings'];

export const DEFAULT_USERS: User[] = [];

export const INITIAL_PATIENTS: Patient[] = [];

// Get current YYYY-MM-DD
const today = new Date().toISOString().split('T')[0];

export const INITIAL_APPOINTMENTS: Appointment[] = [];

export const INITIAL_LABS: Lab[] = [];

export const INITIAL_LAB_CASES: LabCase[] = [];
