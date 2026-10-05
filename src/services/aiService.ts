import { Patient, Appointment, Expense, ExpenseItem } from '../types';
import { appointmentDuration, appointmentTimeMinutes, availableAppointmentTimes, findAppointmentConflicts, occupiesAppointmentSlot } from '../components/appointments/appointmentScheduling';

export interface ExtractedInvoice {
  supplierName?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  invoiceTime?: string;
  supplierAddress?: string;
  supplierPhone?: string;
  taxNumber?: string;
  commercialRecord?: string;
  paymentMethod?: 'cash' | 'card' | 'transfer' | 'credit' | 'deferred';
  category?: 'supplies' | 'fixed' | 'maintenance' | 'other';
  subtotal?: number;
  discount?: number;
  tax?: number;
  totalAmount?: number;
  paidAmount?: number;
  remainingAmount?: number;
  currency?: string;
  notes?: string;
  lineItems?: Array<{
    itemName: string;
    quantity: number;
    unit?: string;
    unitPrice: number;
    discount?: number;
    tax?: number;
    total: number;
    notes?: string;
    confidence?: number;
  }>;
  fieldConfidence?: Record<string, number>;
}

export interface SmartSearchResult {
  matchedIds: string[];
  explanation: string;
}

export interface ScheduleRecommendation {
  estimatedMinutes: number;
  suggestedSlots: string[];
  workloadStatus: 'light' | 'balanced' | 'busy';
  warningNote?: string;
  recommendation: string;
}

export interface FinancialInsightsResult {
  insights: string[];
  recommendation: string;
}

export interface EndodonticAnalysis {
  toothNumber: string;
  canals: Array<{
    name: string;
    estimatedLengthMm: number;
    confidence: string;
  }>;
  apicalLimitNote: string;
  autoCleanupFlag: boolean;
  recommendation: string;
}

export interface ClinicalSummaryResult {
  dailyBrief: string;
  alerts: string[];
}

export const AiService = {
  // 1. Extract Invoice data via Gemini OCR
  async extractInvoice(imageBase64: string, mimeType = 'image/jpeg'): Promise<ExtractedInvoice> {
    try {
      const res = await fetch('/api/ai/extract-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mimeType }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return await res.json();
    } catch (err) {
      throw new Error('تعذر استخراج بيانات الفاتورة. راجع اتصال الخدمة أو أدخل البنود يدويًا.');
    }
  },

  // 2. Intelligent Natural Language Patient Search
  async smartSearch(query: string, patients: Patient[]): Promise<SmartSearchResult> {
    try {
      // Send minified patient metadata to save payload
      const minifiedPatients = patients.map(p => ({
        id: p.id,
        name: p.name,
        mobile: p.mobile,
        age: p.age,
        notes: p.notes,
        allergy: p.allergy,
        sessionCount: p.sessions?.length || 0,
        recentServices: p.sessions?.slice(-3).map(s => s.type || s.diagnosis).join(', '),
        unpaidBalance: p.sessions?.reduce((acc, s) => acc + (s.remain || 0), 0) || 0,
      }));

      const res = await fetch('/api/ai/smart-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, patients: minifiedPatients }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('AiService.smartSearch fallback:', err);
      const q = query.toLowerCase();
      const matchedIds = patients
        .filter(
          p =>
            p.name.toLowerCase().includes(q) ||
            p.mobile?.includes(q) ||
            p.id.includes(q) ||
            p.notes?.toLowerCase().includes(q) ||
            p.sessions?.some(s => s.type?.toLowerCase().includes(q) || s.diagnosis?.toLowerCase().includes(q))
        )
        .map(p => p.id);
      return { matchedIds, explanation: 'بحث نصي مباشر' };
    }
  },

  // 3. AI Appointment Scheduler & Duration Estimator
  async suggestSchedule(
    procedureType: string,
    date: string,
    existingAppointments: Appointment[]
  ): Promise<ScheduleRecommendation> {
    const durationPresets: Record<string, number> = {
      'كشف واستشارة': 20,
      'علاج عصب': 60,
      'علاج عصب (Root Canal)': 60,
      'خلع أسنان': 30,
      'تركيب طربوش': 45,
      'طربوش زيركون / PFM': 45,
      'حشو ليزر تجميلي': 35,
      'تنظيف وتلميع أسنان': 30,
      'جلسة متابعة': 15,
    };
    const defaultDuration = durationPresets[procedureType.trim()] || 30;
    const dayAppointments = existingAppointments.filter(appointment => appointment.date === date && occupiesAppointmentSlot(appointment));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch('/api/ai/schedule-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ procedureType, date, existingAppointments: dayAppointments }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const result = await res.json();
      if (!result || !Number.isFinite(result.estimatedMinutes) || result.estimatedMinutes < 10 || result.estimatedMinutes > 180 || !Array.isArray(result.suggestedSlots)) {
        throw new Error('Invalid schedule recommendation');
      }
      return {
        estimatedMinutes: result.estimatedMinutes,
        suggestedSlots: result.suggestedSlots.filter((time: unknown) => typeof time === 'string' && appointmentTimeMinutes(time) !== null && !findAppointmentConflicts(dayAppointments, date, time, result.estimatedMinutes).length),
        workloadStatus: ['light', 'balanced', 'busy'].includes(result.workloadStatus) ? result.workloadStatus : 'balanced',
        recommendation: typeof result.recommendation === 'string' ? result.recommendation : `مدة الحجز التقديرية: ${result.estimatedMinutes} دقيقة.`,
        warningNote: typeof result.warningNote === 'string' ? result.warningNote : undefined,
      };
    } catch (err) {
      console.warn('AiService.suggestSchedule fallback:', err);
      const busyMinutes = dayAppointments.reduce((total, appointment) => total + appointmentDuration(appointment.durationMinutes), 0);
      return {
        estimatedMinutes: defaultDuration,
        suggestedSlots: availableAppointmentTimes(dayAppointments, date, defaultDuration).slice(0, 3),
        workloadStatus: busyMinutes > 300 ? 'busy' : 'balanced',
        recommendation: durationPresets[procedureType.trim()]
          ? `اقتراح محلي من جدول العيادة. مدة الحجز التقديرية لإجراء ${procedureType}: ${defaultDuration} دقيقة.`
          : 'اقتراح محلي من جدول العيادة بمدة افتراضية ٣٠ دقيقة. راجع المدة المناسبة للإجراء قبل الحجز.',
        warningNote: 'الأوقات مقترحة حسب الحجوزات المسجلة، والمدة تقديرية.',
      };
    } finally {
      clearTimeout(timeout);
    }
  },

  // 4. Financial AI Insights
  async generateFinancialInsights(
    currentMonthRevenue: number,
    currentMonthExpenses: number,
    categoryTotals: Record<string, number>,
    previousMonthRevenue = 0,
    previousMonthExpenses = 0
  ): Promise<FinancialInsightsResult> {
    try {
      const res = await fetch('/api/ai/financial-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentMonthRevenue,
          currentMonthExpenses,
          categoryTotals,
          previousMonthRevenue,
          previousMonthExpenses,
        }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('AiService.generateFinancialInsights fallback:', err);
      return {
        insights: [
          `إجمالي تحصيلات الشهر: ${currentMonthRevenue.toLocaleString()} ج.م.`,
          `إجمالي المصروفات: ${currentMonthExpenses.toLocaleString()} ج.م.`,
          `صافي الأرباح: ${(currentMonthRevenue - currentMonthExpenses).toLocaleString()} ج.م.`,
        ],
        recommendation: 'مراجعة دورية للمصروفات الثابتة تضمن استقرار الهامش الربحي للعيادة.',
      };
    }
  },

  // 5. Endodontic Working Length Assistant
  async analyzeEndoWorkingLength(imageBase64: string, toothNumber: string): Promise<EndodonticAnalysis> {
    try {
      const res = await fetch('/api/ai/endodontic-helper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, toothNumber }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return await res.json();
    } catch (err) {
      throw new Error('تعذر تحليل الصورة. لا توجد قياسات مستخرجة؛ يرجى مراجعة إعدادات الخدمة.');
    }
  },

  // 6. Clinical & Daily Summary
  async getClinicalSummary(payload: {
    appointmentsCount: number;
    totalRevenue: number;
    pendingFollowUps: number;
    totalDebt: number;
    newPatientsCount: number;
  }): Promise<ClinicalSummaryResult> {
    try {
      const res = await fetch('/api/ai/clinical-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('AiService.getClinicalSummary fallback:', err);
      return {
        dailyBrief: `موجز العيادة: ${payload.appointmentsCount} مواعيد، إجمالي تحصيلات ${payload.totalRevenue} ج.م.`,
        alerts: payload.pendingFollowUps > 0 ? [`توجد ${payload.pendingFollowUps} حالات متابعة منتظرة.`] : [],
      };
    }
  },
};

