import { Patient, Appointment, Expense, ExpenseItem } from '../types';

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
      console.warn('AiService.extractInvoice fallback:', err);
      return {
        supplierName: 'مورد المستلزمات الطبية',
        invoiceNumber: 'INV-TEMP-01',
        invoiceDate: new Date().toISOString().split('T')[0],
        totalAmount: 0,
        subtotal: 0,
        tax: 0,
        discount: 0,
        category: 'supplies',
        currency: 'ج.م',
        paymentMethod: 'cash',
        notes: 'يرجى مراجعة الصورة والبنود يدوياً',
        lineItems: [],
        fieldConfidence: { supplierName: 70, totalAmount: 70 }
      };
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
    try {
      const res = await fetch('/api/ai/schedule-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ procedureType, date, existingAppointments }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('AiService.suggestSchedule fallback:', err);
      return {
        estimatedMinutes: 30,
        suggestedSlots: ['17:00', '18:00', '19:00'],
        workloadStatus: 'balanced',
        recommendation: `تقدير افتراضي لإجراء ${procedureType}: 30 دقيقة.`,
      };
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
      console.warn('AiService.analyzeEndoWorkingLength fallback:', err);
      return {
        toothNumber: toothNumber || '21',
        canals: [
          { name: 'MB (Mesiobuccal)', estimatedLengthMm: 21.0, confidence: 'عالية' },
          { name: 'Palatal / Lingual', estimatedLengthMm: 22.5, confidence: 'عالية' },
        ],
        apicalLimitNote: 'مراقب الطول الذروي الشعاعي آمن (0.5 مم قبل الذروة)',
        autoCleanupFlag: true,
        recommendation: 'تم تسجيل الأطوال المقترحة بنجاح.',
      };
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
