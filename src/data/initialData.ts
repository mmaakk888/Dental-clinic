import { Patient, Appointment, Lab, LabCase, ThemeSettings, UILabels, User, Expense, WhatsappSettings, DrugCatalogItem } from '../types';

export const INITIAL_EXPENSES: Expense[] = [
  {
    id: 'exp1',
    title: 'شراء خامات حشو أسنان ومخدر زيلوكين',
    category: 'supplies',
    amount: 1450,
    date: '2026-07-01',
    note: 'شراء من شركة العالمية للمستلزمات الطبية'
  },
  {
    id: 'exp2',
    title: 'إيجار مقر العيادة لشهر يوليو',
    category: 'fixed',
    amount: 6000,
    date: '2026-07-01',
    note: 'تحويل بنكي للمالك'
  },
  {
    id: 'exp3',
    title: 'صيانة وحدة الأسنان وتغيير خرطوم الشفاط',
    category: 'maintenance',
    amount: 850,
    date: '2026-07-10',
    note: 'فني صيانة معتمد'
  }
];

export const DEFAULT_WHATSAPP_SETTINGS: WhatsappSettings = {
  apiKey: '',
  webhookUrl: '',
  senderNumber: '01012345678',
  autoConfirmOnAppt: true,
  autoRemind24h: true,
  autoPostOpOnAttended: true,
  templates: {
    reminderTomorrow: 'أهلاً بك أ. {patientName}، نود تذكيرك بموعدك يوم {date} الساعة {time} في {clinicName}. يسعدنا حضورك!',
    newAppt: 'أهلاً بك أ. {patientName}، تم حجز موعد جديد لك يوم {date} الساعة {time} في {clinicName}.',
    postOp: 'أهلاً بك أ. {patientName}، نتمنى لك الشفاء العاجل! نرفق لك تعليمات الهامة بعد الجلسة:\n1) الالتزام بالأدوية في مواعيدها.\n2) تجنب المشروبات الساخنة 24 ساعة.\n3) التواصل معنا فوراً عند أي استفسار.',
    accountBalance: 'أهلاً بك أ. {patientName}، نود إحاطتك علماً بأن المتبقي على حساب ملفك برقم #{fileNo} هو {remainingBalance} ج.م. يسعدنا تواصلك معنا دائماً.'
  }
};

export const DEFAULT_DRUG_CATALOG: DrugCatalogItem[] = [
  { id: 'd1', name: 'أوجمنتين 1 جَم (Augmentin 1g)', category: 'مضاد حيوي', defaultDosage: 'قرص كل 12 ساعة بعد الأكل', defaultDuration: 'لمدة 5-7 أيام' },
  { id: 'd2', name: 'كاتافلام 50 مجم (Cataflam 50mg)', category: 'مسكن ومضاد للالتهاب', defaultDosage: 'قرص عند اللزوم بعد الأكل', defaultDuration: 'عند الحاجة' },
  { id: 'd3', name: 'فلاجيل 500 مجم (Flagyl 500mg)', category: 'مضاد للمطثيات والتهابات اللثة', defaultDosage: 'قرص كل 8 ساعات بعد الأكل', defaultDuration: 'لمدة 5 أيام' },
  { id: 'd4', name: 'باراسيتامول 500 مجم (Paracetamol)', category: 'مسكن خفيف وخافض حرارة', defaultDosage: '1-2 قرص عند اللزوم', defaultDuration: 'عند الحاجة' },
  { id: 'd5', name: 'بروفين 600 مجم (Brufen 600mg)', category: 'مسكن آلام وتورم', defaultDosage: 'قرص كل 8 ساعات بعد الأكل', defaultDuration: 'لمدة 3 أيام' },
  { id: 'd6', name: 'جينجيجل جيل (Gengigel Oral Gel)', category: 'جيل موضعي للثة', defaultDosage: 'دهان موضع اللثة 3 مرات يومياً', defaultDuration: 'لمدة أسبوع' }
];

export const DEFAULT_SERVICE_TYPES = [
  "حشو عادي",
  "حشو ليزر",
  "علاج عصب",
  "تركيبات - ثابتة",
  "تركيبات - متحركة",
  "خلع جراحي",
  "تنظيف وتلميع",
  "تبييض أسنان",
  "حافظ مسافة"
];

export const DEFAULT_PATIENT_CROWN_PRICES: Record<string, number> = {
  "PFM": 1200,
  "زيركون": 2200,
  "إيماكس": 2800
};

export const DEFAULT_THEME: ThemeSettings = {
  primary: '#4f46e5',
  secondary: '#4338ca',
  accent: '#6366f1',
  background: '#f8fafc',
  fontFamily: "'Cairo', sans-serif"
};

export const DEFAULT_UI_LABELS: UILabels = {
  homeSubtitle: 'عيادة الدكتورة مريم علي للأسنان — شاشة غرفة الكشف والإدارة',
  welcomeText: 'أهلاً بك يا دكتور، اختر القسم المطلوب للمتابعة',
  tiles: {
    patients: { title: 'فهرس الحالات', desc: 'إدارة ملفات المرضى، السجل الطبي والمالي' },
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

export const DEFAULT_TILE_ORDER = ['patients', 'appointments', 'lab', 'summary', 'settings'];

export const DEFAULT_USERS: User[] = [
  {
    id: 'u1',
    name: 'د. أحمد محمود',
    username: 'dr_ahmed',
    // Local demo fixture only. Production requires authoritative authentication.
    password: 'pbkdf2-sha256$600000$de5544403a9c9ae58f4ffceb76325870$20a93dfc0fbc579a4d049da7f58b4441def375dfb7cbf7217c428c1078f37fc7',
    email: 'dr.ahmed@clinic.com',
    phone: '01012345678',
    role: 'doctor',
    credentialVersion: 1,
    isActive: true,
    permissions: {
      patientView: true,
      patientEdit: true,
      deletePatients: true,
      patientFinance: true,
      appointments: true,
      lab: true,
      labProfit: true,
      summary: true,
      controlPanel: true
    }
  },
  {
    id: 'u2',
    name: 'سارة - الاستقبال',
    username: 'sara_reception',
    // Local demo fixture only. Production requires authoritative authentication.
    password: 'pbkdf2-sha256$600000$4247a7eaa7a46a03996d20d3b1c861ab$815352fbbab876d12d78ab44a4cd5afd79ac10025d1f1ddf09dd3efa9e73683b',
    email: 'sara@clinic.com',
    phone: '01198765432',
    role: 'secretary',
    credentialVersion: 1,
    isActive: true,
    permissions: {
      patientView: true,
      patientEdit: true,
      deletePatients: false,
      patientFinance: true,
      appointments: true,
      lab: false,
      labProfit: false,
      summary: false,
      controlPanel: false
    }
  }
];

export const INITIAL_PATIENTS: Patient[] = [
  {
    id: '101',
    name: 'محمد إبراهيم حسن',
    mobile: '01012345678',
    age: 34,
    firstVisit: '2026-05-10',
    notes: 'يفضل المواعيد المسائية. يعاني من حساسية لثوية خفيفة.',
    allergy: 'حساسية البنسلين',
    sessions: [
      {
        id: 's101-1',
        type: 'حشو ليزر',
        tooth: 'ur5',
        toothNum: '5',
        toothLabel: 'الربع العلوي يمين - سنة 5',
        amount: 600,
        paid: 600,
        remain: 0,
        date: '2026-05-10',
        payDate: '2026-05-10',
        paymentsLog: [{ id: 'p1', amount: 600, date: '2026-05-10' }]
      },
      {
        id: 's101-2',
        type: 'تركيبات - ثابتة',
        tooth: 'ur4',
        teethIds: ['ur4', 'ur5', 'ur6'],
        toothNum: '4',
        toothLabel: 'الربع العلوي يمين (مدى 4 إلى 6)',
        amount: 3600,
        paid: 2000,
        remain: 1600,
        date: '2026-06-15',
        payDate: '2026-06-15',
        paymentsLog: [{ id: 'p2', amount: 2000, date: '2026-06-15' }]
      }
    ],
    payments: [{ id: 'gp1', amount: 2600, date: '2026-06-15', legacyAggregate: true }]
  },
  {
    id: '102',
    name: 'سارة عبد الفتاح أحمد',
    mobile: '01198765432',
    age: 28,
    firstVisit: '2026-06-01',
    notes: 'علاج عصب مكتمل للسنة العلوي شمال 2.',
    allergy: '',
    sessions: [
      {
        id: 's102-1',
        type: 'علاج عصب',
        tooth: 'ul2',
        toothNum: '2',
        toothLabel: 'الربع العلوي شمال - سنة 2',
        amount: 1200,
        paid: 1200,
        remain: 0,
        date: '2026-06-01',
        payDate: '2026-06-01',
        paymentsLog: [
          { id: 'p3', amount: 600, date: '2026-06-01' },
          { id: 'p4', amount: 600, date: '2026-06-08' }
        ]
      }
    ],
    payments: [{ id: 'gp2', amount: 1200, date: '2026-06-08', legacyAggregate: true }]
  },
  {
    id: '103',
    name: 'محمود الشريف',
    mobile: '01234567890',
    age: 45,
    firstVisit: '2026-07-02',
    notes: 'حالة خلع جراحي وتجهيز لتركيب جسر متحرك.',
    allergy: 'ضغط دم مرتفع',
    sessions: [
      {
        id: 's103-1',
        type: 'خلع جراحي',
        tooth: 'lr6',
        toothNum: '6',
        toothLabel: 'الربع السفلي يمين - سنة 6',
        amount: 800,
        paid: 500,
        remain: 300,
        date: '2026-07-02',
        payDate: '2026-07-02',
        paymentsLog: [{ id: 'p5', amount: 500, date: '2026-07-02' }]
      }
    ],
    payments: [{ id: 'gp3', amount: 500, date: '2026-07-02', legacyAggregate: true }]
  },
  {
    id: '104',
    name: 'أميرة جابر السيد',
    mobile: '01511223344',
    age: 22,
    firstVisit: '2026-07-12',
    notes: 'تنظيف وتلميع دوري مع تبييض ليزر.',
    allergy: '',
    sessions: [
      {
        id: 's104-1',
        type: 'تنظيف وتلميع',
        tooth: null,
        amount: 400,
        paid: 400,
        remain: 0,
        date: '2026-07-12',
        payDate: '2026-07-12',
        paymentsLog: [{ id: 'p6', amount: 400, date: '2026-07-12' }]
      }
    ],
    payments: [{ id: 'gp4', amount: 400, date: '2026-07-12', legacyAggregate: true }]
  },
  {
    id: '105',
    name: 'طارق عبد المحسن',
    mobile: '01099887766',
    age: 50,
    firstVisit: '2026-07-20',
    notes: 'تركيبة زيركون للسن السفلية اليسرى.',
    allergy: '',
    sessions: [
      {
        id: 's105-1',
        type: 'تركيبات - ثابتة',
        tooth: 'll1',
        teethIds: ['ll1'],
        toothNum: '1',
        toothLabel: 'الربع السفلي شمال - سنة 1',
        amount: 2200,
        paid: 1000,
        remain: 1200,
        date: '2026-07-20',
        payDate: '2026-07-20',
        paymentsLog: [{ id: 'p7', amount: 1000, date: '2026-07-20' }]
      }
    ],
    payments: [{ id: 'gp5', amount: 1000, date: '2026-07-20', legacyAggregate: true }]
  }
];

// Get current YYYY-MM-DD
const today = new Date().toISOString().split('T')[0];

export const INITIAL_APPOINTMENTS: Appointment[] = [
  {
    id: 'a1',
    patientId: '101',
    fileNo: '101',
    patientName: 'محمد إبراهيم حسن',
    mobile: '01012345678',
    date: today,
    time: '11:00',
    note: 'تركيب الجسر النهائي (زيركون 3 طرابيش)',
    isFollowUp: true,
    isWalkIn: false,
    status: 'scheduled'
  },
  {
    id: 'a2',
    patientId: '102',
    fileNo: '102',
    patientName: 'سارة عبد الفتاح أحمد',
    mobile: '01198765432',
    date: today,
    time: '12:30',
    note: 'متابعة بعد علاج العصب وفحص الحشو',
    isFollowUp: true,
    isWalkIn: false,
    status: 'attended'
  },
  {
    id: 'a3',
    patientId: '105',
    fileNo: '105',
    patientName: 'طارق عبد المحسن',
    mobile: '01099887766',
    date: today,
    time: '17:00',
    note: 'مقاس التركيبة وتجربة الزيركون',
    isFollowUp: false,
    isWalkIn: false,
    status: 'scheduled'
  },
  {
    id: 'a4',
    patientId: '103',
    fileNo: '103',
    patientName: 'محمود الشريف',
    mobile: '01234567890',
    date: today,
    time: '18:15',
    note: 'كشف مفاجئ آلام باللثة',
    isFollowUp: false,
    isWalkIn: true,
    status: 'scheduled'
  }
];

export const INITIAL_LABS: Lab[] = [
  {
    id: 'lab1',
    name: 'معمل النور للتركيبات',
    phone: '01001122334',
    address: 'الدقي - القاهرة',
    notes: 'متخصص في الزيركون والإيماكس، التسليم خلال 3 أيام.',
    services: [
      { id: 'ls1', category: 'fixed', name: 'PFM', unitLabel: 'طربوش', price: 400 },
      { id: 'ls2', category: 'fixed', name: 'زيركون', unitLabel: 'طربوش', price: 750 },
      { id: 'ls3', category: 'fixed', name: 'إيماكس', unitLabel: 'طربوش', price: 900 },
      { id: 'ls4', category: 'removable', name: 'طقم كامل', unitLabel: 'طقم', price: 1500 }
    ]
  },
  {
    id: 'lab2',
    name: 'معمل الأمل التخصصي',
    phone: '01223344556',
    address: 'مدينة نصر - القاهرة',
    notes: 'دقة عالية مع خامات مستوردة ضمان 5 سنوات.',
    services: [
      { id: 'ls5', category: 'fixed', name: 'PFM', unitLabel: 'طربوش', price: 380 },
      { id: 'ls6', category: 'fixed', name: 'زيركون', unitLabel: 'طربوش', price: 700 },
      { id: 'ls7', category: 'other', name: 'حافظ مسافة', unitLabel: 'وحدة', price: 300 }
    ]
  }
];

export const INITIAL_LAB_CASES: LabCase[] = [
  {
    id: 'lc1',
    labId: 'lab1',
    labName: 'معمل النور للتركيبات',
    patientId: '101',
    patientName: 'محمد إبراهيم حسن',
    fileNo: '101',
    type: 'تركيبات - ثابتة',
    subType: 'زيركون',
    units: 3,
    unitLabel: 'طربوش',
    labTotal: 2250, // 3 * 750
    labPaid: 1500,
    patientTotal: 3600, // 3 * 1200
    patientPaid: 2000,
    date: '2026-06-15',
    note: 'جسر زيركون من السنة 4 إلى 6 علوي يمين',
    status: 'delivered',
    paymentsLog: [{ id: 'lp1', amount: 1500, date: '2026-06-18' }]
  },
  {
    id: 'lc2',
    labId: 'lab2',
    labName: 'معمل الأمل التخصصي',
    patientId: '105',
    patientName: 'طارق عبد المحسن',
    fileNo: '105',
    type: 'تركيبات - ثابتة',
    subType: 'زيركون',
    units: 1,
    unitLabel: 'طربوش',
    labTotal: 700,
    labPaid: 0,
    patientTotal: 2200,
    patientPaid: 1000,
    date: '2026-07-20',
    note: 'طربوش مفرد زيركون',
    status: 'pending'
  }
];
