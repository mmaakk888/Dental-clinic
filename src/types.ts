export interface PaymentInstallment {
  id: string;
  amount: number;
  date: string;
}

export interface ExpenseItem {
  id: string;
  expenseId?: string;
  itemName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discount?: number;
  tax?: number;
  total: number;
  notes?: string;
  confidence?: number;
}

export interface ExpenseAuditLog {
  id: string;
  action: string;
  user: string;
  timestamp: string;
  details?: string;
}

export interface PriceVarianceAlert {
  itemName: string;
  previousPrice: number;
  currentPrice: number;
  percentageIncrease: number;
  unit: string;
  lastPurchaseDate?: string;
}

export interface Expense {
  id: string;
  title: string;
  category: 'supplies' | 'fixed' | 'maintenance' | 'other';
  amount: number;
  date: string;
  note?: string;
  isFixed?: boolean;
  recurringPeriod?: 'monthly' | 'yearly' | 'none';
  invoiceImageUrl?: string;
  
  // Extended ERP Supplier Invoice Fields
  supplierName?: string;
  supplierId?: string;
  supplierPhone?: string;
  supplierAddress?: string;
  supplierLogo?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  invoiceTime?: string;
  taxNumber?: string;
  commercialRecord?: string;
  paymentMethod?: 'cash' | 'card' | 'transfer' | 'credit' | 'deferred';
  subtotal?: number;
  tax?: number;
  discount?: number;
  discountType?: 'flat' | 'percentage';
  paidAmount?: number;
  remainingAmount?: number;
  currency?: string;
  items?: ExpenseItem[];
  confidenceScores?: Record<string, number>;
  priceVarianceAlerts?: PriceVarianceAlert[];
  auditLog?: ExpenseAuditLog[];
  updatedAt?: string;
  createdAt?: string;
}

export interface PrescriptionItem {
  id: string;
  drugName: string;
  dosage: string;
  duration?: string;
}

export interface Prescription {
  id: string;
  patientId: string;
  patientName: string;
  fileNo: string;
  date: string;
  diagnosis?: string;
  items: PrescriptionItem[];
  instructions?: string;
}

export interface DrugCatalogItem {
  id: string;
  name: string;
  category: string;
  defaultDosage: string;
  defaultDuration: string;
}

export interface WhatsappSettings {
  apiKey: string;
  webhookUrl: string;
  senderNumber: string;
  autoConfirmOnAppt: boolean;
  autoRemind24h: boolean;
  autoPostOpOnAttended: boolean;
  templates: {
    reminderTomorrow: string;
    newAppt: string;
    postOp: string;
    accountBalance: string;
  };
}

export interface SessionServiceItem {
  id: string;
  name: string; // e.g. 'كشف', 'خلع', 'حشو', 'علاج عصب', 'تنظيف', 'أشعة', 'خدمة أخرى'
  price: number;
  paid?: number;
  discount?: number;
}

export interface Session {
  id: string;
  type: string;
  tooth: string | null; // composite ID e.g. "ur5", "ul2", "lr6", "ll1"
  teethIds?: string[];  // array of composite IDs for range e.g. ["ur4", "ur5", "ur6"]
  toothNum?: string;
  toothLabel?: string;
  amount: number;
  paid: number;
  remain: number;
  discount?: number; // الخصم / الإعفاء المالي
  date: string;
  payDate?: string;
  paymentsLog: PaymentInstallment[];
  // Visit metadata & multi-procedure items
  chiefComplaint?: string;
  diagnosis?: string;
  procedurePerformed?: string;
  services?: SessionServiceItem[]; // قائمة الخدمات المنفذة تفصيلياً
  prescriptionNotes?: string;
  visitNotes?: string;
  examinationFee?: number;
  treatmentFee?: number;
  paymentMethod?: 'cash' | 'card' | 'transfer';
  isWalkIn?: boolean;
  visitStatus?: 'completed' | 'follow_up';
  doctorName?: string;
  time?: string;
}

export interface GeneralPayment {
  id: string;
  amount: number;
  date: string;
  paymentMethod?: 'cash' | 'card' | 'transfer';
  note?: string;
}

export interface Patient {
  id: string; // File Number e.g. "101"
  name: string;
  mobile: string;
  age: number;
  gender?: string;
  firstVisit: string; // YYYY-MM-DD
  notes: string;
  allergy: string;
  sessions: Session[];
  payments: GeneralPayment[];
}

export interface AppointmentReminderLog {
  sentAt: string;
  type: 'whatsapp' | 'sms';
  channel: 'manual_wa' | 'api_wa' | 'sms';
  status: 'sent' | 'pending' | 'failed';
}

export type AppointmentStatus = 'scheduled' | 'waiting' | 'attended' | 'no_show' | 'apologized' | 'confirmed' | 'cancelled';

export interface Appointment {
  id: string;
  patientId: string;
  fileNo: string;
  patientName: string;
  mobile: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm in 24h format internally, formatted to 12h with ص/م
  note: string;
  doctorName?: string;
  durationMinutes?: number;
  appointmentType?: string;
  isFollowUp: boolean;
  isWalkIn: boolean;
  status: AppointmentStatus;
  reminderSent?: boolean;
  reminderLog?: AppointmentReminderLog[];
}

export interface LabService {
  id: string;
  category: 'fixed' | 'removable' | 'other';
  name: string; // e.g. "PFM", "زيركون", "نص طقم", "طقم كامل", "حافظ مسافة"
  unitLabel: string; // e.g. "طربوش", "طقم", "وحدة"
  price: number; // cost charged by lab
}

export interface Lab {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  notes?: string;
  services: LabService[];
}

export interface LabCase {
  id: string;
  labId: string;
  labName: string;
  patientId: string;
  patientName: string;
  fileNo: string;
  type: string;
  subType: string;
  units: number;
  unitLabel: string;
  labTotal: number;
  labPaid: number;
  patientTotal: number;
  patientPaid: number;
  date: string; // Dispatch/Sent date
  deliveryExpectedDate?: string; // Expected delivery date
  note?: string;
  status: 'pending' | 'ready' | 'delivered' | 'delayed' | 'completed';
  paymentsLog?: PaymentInstallment[];
}

export interface ThemeSettings {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  fontFamily?: string;
  customFontUrl?: string;
}

export interface UILabels {
  homeSubtitle: string;
  welcomeText: string;
  tiles: Record<string, { title: string; desc: string }>;
  tabs: Record<string, string>;
}

export interface UserPermission {
  patientView: boolean;
  patientEdit: boolean;
  deletePatients: boolean;
  patientFinance: boolean;
  appointments: boolean;
  lab: boolean;
  labProfit: boolean;
  summary: boolean;
  controlPanel: boolean;
  // Granular Collections & Financial Permissions
  registerPayment?: boolean;
  viewRemainingBalance?: boolean;
  viewTodayCollections?: boolean;
  editPayment?: boolean;
  deletePayment?: boolean;
  viewExpenses?: boolean;
  viewProfits?: boolean;
  managePrices?: boolean;
  financialReports?: boolean;
}

export interface User {
  id: string;
  name: string;
  username: string;
  password?: string;
  email?: string;
  phone?: string;
  role: 'doctor' | 'secretary' | 'admin';
  permissions: UserPermission;
}

export type DeviceMode = 'auto' | 'mobile' | 'desktop' | 'tv';

export type ActiveView = 
  | 'home'
  | 'patients'
  | 'patient-file'
  | 'appointments'
  | 'lab'
  | 'lab-detail'
  | 'summary'
  | 'settings'
  | 'secretary-desk';

export type NavigationOrigin = 'patients' | 'appointments' | 'home' | 'lab';
