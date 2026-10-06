import express from 'express';
import 'dotenv/config';
import path from 'path';
import { createAiSecurity, aiBodyLimit, releaseAiRequest } from './server/security';
import type { AiSecurityOptions } from './server/security';
import { GoogleGenAI, Type } from '@google/genai';

export interface ServerOptions extends AiSecurityOptions {
  createAiClient?: () => GoogleGenAI | null;
}

export function createApiApp(options: ServerOptions = {}) {
  const app = express();
  const env = options.env || process.env;
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (env.NODE_ENV === 'production') res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebaseapp.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    next();
  });
  const security = createAiSecurity(options);
  const imageParser = express.json({ limit: aiBodyLimit('/extract-invoice'), strict: true, inflate: false });
  const dataParser = express.json({ limit: aiBodyLimit('/smart-search'), strict: true, inflate: false });
  app.use('/api/ai', security.authorize,
    (req, res, next) => (aiBodyLimit(req.path) === '3mb' ? imageParser : dataParser)(req, res, next),
    security.admit);

  // Helper to initialize Gemini Client
  const getGeminiClient = () => {
    if (options.createAiClient) return options.createAiClient();
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) return null;
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        timeout: 25_000,
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  };

  // 1. AI Invoice / Receipt OCR Endpoint (Full ERP Supplier Invoice Extraction)
  app.post('/api/ai/extract-invoice', async (req, res) => {
    try {
      const { imageBase64, mimeType = 'image/jpeg' } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ error: 'imageBase64 parameter is required' });
      }

      const ai = getGeminiClient();
      if (!ai) {
        return res.status(503).json({ error: 'خدمة تحليل الصور غير مفعّلة. يمكنك إدخال البيانات يدويًا حتى يتم إعداد الخدمة.' });
      }

      const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

      const response = await ai.models.generateContent({
        model: env.GEMINI_MODEL || 'gemini-3.6-flash',
        contents: {
          parts: [
            {
              inlineData: {
                data: cleanBase64,
                mimeType,
              },
            },
            {
              text: `قم بتحليل صورة الفاتورة أو إيصال التوريدات الطبي واستخراج كامل بيانات فاتورة المورد والبنود المذكورة بها بدقة متناهية باللغة العربية.
استخرج:
1. اسم المورد (supplierName)
2. رقم الفاتورة (invoiceNumber)
3. تاريخ الفاتورة بصيغة YYYY-MM-DD (invoiceDate)
4. وقت الفاتورة HH:mm إن وجد (invoiceTime)
5. عنوان المورد (supplierAddress)
6. هاتف المورد (supplierPhone)
7. الرقم الضريبي للمورد (taxNumber)
8. السجل التجاري (commercialRecord)
9. طريقة الدفع: cash أو card أو transfer أو credit (paymentMethod)
10. تصنيف المصروف: supplies أو fixed أو maintenance أو other (category)
11. الإجمالي قبل الضريبة والخصم (subtotal)
12. إجمالي الخصم (discount)
13. إجمالي قيمة الضريبة Value Added Tax (tax)
14. المبلغ الإجمالي الصافي المطلوب بالفاتورة (totalAmount)
15. المبلغ المدفوع بالفعل (paidAmount)
16. المبلغ المتبقي الآجل (remainingAmount)
17. رمز العملة (currency) مثل "ج.م" أو "ر.س" أو "$"
18. ملاحظات الفاتورة والشروط (notes)
19. جدول البنود التفصيلية (lineItems) ولكل بند: اسم الصنف (itemName)، الكمية (quantity)، الوحدة (unit مثل علبة/محقنة/عبوة/قطعة/طقم)، سعر الوحدة (unitPrice)، قيمة الخصم للصنف (discount)، ضريبة الصنف (tax)، إجمالي الصنف الصافي (total)، ملاحظات الصنف (notes).
20. نسبة ثقة الذكاء الاصطناعي في القراءة لكل حقل رئيسي من 0 إلى 100 (fieldConfidence).`,
            },
          ],
        },
        config: {
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              supplierName: { type: Type.STRING },
              invoiceNumber: { type: Type.STRING },
              invoiceDate: { type: Type.STRING },
              invoiceTime: { type: Type.STRING },
              supplierAddress: { type: Type.STRING },
              supplierPhone: { type: Type.STRING },
              taxNumber: { type: Type.STRING },
              commercialRecord: { type: Type.STRING },
              paymentMethod: { type: Type.STRING },
              category: { type: Type.STRING },
              subtotal: { type: Type.NUMBER },
              discount: { type: Type.NUMBER },
              tax: { type: Type.NUMBER },
              totalAmount: { type: Type.NUMBER },
              paidAmount: { type: Type.NUMBER },
              remainingAmount: { type: Type.NUMBER },
              currency: { type: Type.STRING },
              notes: { type: Type.STRING },
              lineItems: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    itemName: { type: Type.STRING },
                    quantity: { type: Type.NUMBER },
                    unit: { type: Type.STRING },
                    unitPrice: { type: Type.NUMBER },
                    discount: { type: Type.NUMBER },
                    tax: { type: Type.NUMBER },
                    total: { type: Type.NUMBER },
                    notes: { type: Type.STRING },
                    confidence: { type: Type.NUMBER },
                  },
                },
              },
              fieldConfidence: {
                type: Type.OBJECT,
                properties: {
                  supplierName: { type: Type.NUMBER },
                  invoiceNumber: { type: Type.NUMBER },
                  totalAmount: { type: Type.NUMBER },
                  taxNumber: { type: Type.NUMBER },
                  lineItems: { type: Type.NUMBER },
                },
              },
            },
          },
        },
      });

      const resultText = response.text || '{}';
      if (resultText.length > 512 * 1024) throw new Error('AI response exceeds limit');
      const parsed = JSON.parse(resultText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid AI response');
      return res.json(parsed);
    } catch (err: any) {
      console.warn('AI request failed without exposing provider details.');
      return res.status(502).json({ error: 'تعذّر إكمال التحليل السحابي. يمكنك إدخال البيانات يدويًا أو المحاولة لاحقًا.' });
    } finally {
      releaseAiRequest(res);
    }
  });

  // 2. AI Smart Patient Search
  app.post('/api/ai/smart-search', async (req, res) => {
    try {
      const { query, patients } = req.body;
      if (!query || !Array.isArray(patients)) {
        return res.status(400).json({ error: 'Query and patients array are required' });
      }

      const ai = getGeminiClient();
      if (!ai) {
        // Fallback client-side substring matching
        const q = query.toLowerCase();
        const matchedIds = patients
          .filter(
            (p: any) =>
              p.name.toLowerCase().includes(q) ||
              p.mobile?.includes(q) ||
              p.id.includes(q) ||
              p.notes?.toLowerCase().includes(q) ||
              p.sessions?.some((s: any) => s.type?.toLowerCase().includes(q) || s.diagnosis?.toLowerCase().includes(q))
          )
          .map((p: any) => p.id);
        return res.json({ matchedIds, explanation: 'نتائج بحث نصي مباشر' });
      }

      const response = await ai.models.generateContent({
        model: env.GEMINI_MODEL || 'gemini-3.6-flash',
        contents: `أنت مساعد ذكي لعيادة أسنان. قم بتحليل استعلام البحث الطبي التالي وتصفية قائمة المرضى المتاحة.
استعلام البحث: "${query}"
قائمة المرضى: ${JSON.stringify(patients)}

حدد معرفات المرضى (id) الأكثر تطابقاً بدقة، واكتب توضيحاً مختصراً باللغة العربية.`,
        config: {
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              matchedIds: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              explanation: { type: Type.STRING },
            },
          },
        },
      });

      const resultText = response.text || '{}';
      if (resultText.length > 512 * 1024) throw new Error('AI response exceeds limit');
      const parsed = JSON.parse(resultText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid AI response');
      return res.json(parsed);
    } catch (err: any) {
      console.warn('AI request failed without exposing provider details.');
      return res.status(502).json({ error: 'تعذّر إكمال التحليل السحابي. يمكنك إدخال البيانات يدويًا أو المحاولة لاحقًا.' });
    } finally {
      releaseAiRequest(res);
    }
  });

  // 3. AI Smart Appointments & Workload Balancer
  app.post('/api/ai/schedule-assistant', async (req, res) => {
    try {
      const { procedureType, date, existingAppointments } = req.body;
      const ai = getGeminiClient();

      // Standard procedure duration estimations
      const defaultDurations: Record<string, number> = {
        'علاج عصب': 60,
        'خلع': 30,
        'خلع أسنان': 30,
        'علاج عصب (Root Canal)': 60,
        'تركيب طربوش': 45,
        'طربوش زيركون / PFM': 45,
        'طربوش زيركون': 45,
        'حشو ليزر': 35,
        'حشو ليزر تجميلي': 35,
        'تنظيف وتلميع': 30,
        'تنظيف وتلميع أسنان': 30,
        'كشف واستشارة': 20,
        'متابعة': 15,
        'جلسة متابعة': 15,
      };

      const estimatedMinutes = defaultDurations[procedureType] || 30;

      if (!ai) {
        // Smart rules fallback
        const totalBusyMinutes = (existingAppointments || []).reduce(
          (acc: number, appt: any) => acc + (appt.durationMinutes || 30),
          0
        );
        const isOverloaded = totalBusyMinutes > 300;
        return res.json({
          estimatedMinutes,
          suggestedSlots: ['17:30', '18:30', '19:15'],
          workloadStatus: isOverloaded ? 'busy' : 'balanced',
          warningNote: isOverloaded ? 'اليوم به إشغال مرتفع في العيادة، يُنصح بتخفيف المواعيد المعقدة.' : undefined,
          recommendation: `اقتراح محلي بمدة تقديرية ${estimatedMinutes} دقيقة. راجع الوقت والمدة قبل الحجز.`,
        });
      }

      const response = await ai.models.generateContent({
        model: env.GEMINI_MODEL || 'gemini-3.6-flash',
        contents: `قم بتحليل جدول مواعيد عيادة الأسنان لهذا اليوم المقترح: ${date}
الإجراء المطلوبة جدولته: "${procedureType}"
المواعيد المحجوزة حالياً: ${JSON.stringify(existingAppointments || [])}

احسب مدة الإجراء بالدقائق، واقترح أفضل 3 أوقات (HH:mm) لتجنب الازدحام وموازنة جهد الطبيب، وتوقع حالة ضغط العمل (light/balanced/busy).`,
        config: {
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              estimatedMinutes: { type: Type.NUMBER },
              suggestedSlots: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              workloadStatus: { type: Type.STRING },
              warningNote: { type: Type.STRING },
              recommendation: { type: Type.STRING },
            },
          },
        },
      });

      const resultText = response.text || '{}';
      if (resultText.length > 512 * 1024) throw new Error('AI response exceeds limit');
      const parsed = JSON.parse(resultText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid AI response');
      return res.json(parsed);
    } catch (err: any) {
      console.warn('AI request failed without exposing provider details.');
      return res.status(502).json({ error: 'تعذّر إكمال التحليل السحابي. يمكنك إدخال البيانات يدويًا أو المحاولة لاحقًا.' });
    } finally {
      releaseAiRequest(res);
    }
  });

  // 4. AI Financial Insights
  app.post('/api/ai/financial-insights', async (req, res) => {
    try {
      const { currentMonthRevenue, currentMonthExpenses, categoryTotals, previousMonthRevenue, previousMonthExpenses } = req.body;
      const ai = getGeminiClient();

      if (!ai) {
        const netProfit = currentMonthRevenue - currentMonthExpenses;
        return res.json({
          insights: [
            `صافي أرباح الشهر الحالي حتى الآن: ${netProfit.toLocaleString()} ج.م.`,
            `يمثل إنفاق المستلزمات الطبية النسبة الأكبر من المصروفات التشغيلية.`,
            `متوسط تكلفة المستلزمات لكل جلسة علاجية مستقر ومناسب.`,
          ],
          recommendation: 'استمر في متابعة وتوثيق فواتير التوريدات بالكاميرا أولاً بأول.',
        });
      }

      const response = await ai.models.generateContent({
        model: env.GEMINI_MODEL || 'gemini-3.6-flash',
        contents: `أنت مستشار مالي لعيادة أسنان. حلل البيانات المالية التالية واكتب 3-4 نقاط استباقية باللغة العربية مع نصيحة عملية مخصصة للطبيب.
إيراد الشهر الحالي: ${currentMonthRevenue} ج.م
مصروفات الشهر الحالي: ${currentMonthExpenses} ج.م
توزيع المصروفات حسب التصنيف: ${JSON.stringify(categoryTotals)}
إيرادات الشهر السابق: ${previousMonthRevenue || 0} ج.م
مصروفات الشهر السابق: ${previousMonthExpenses || 0} ج.م`,
        config: {
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              insights: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              recommendation: { type: Type.STRING },
            },
          },
        },
      });

      const resultText = response.text || '{}';
      if (resultText.length > 512 * 1024) throw new Error('AI response exceeds limit');
      const parsed = JSON.parse(resultText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid AI response');
      return res.json(parsed);
    } catch (err: any) {
      console.warn('AI request failed without exposing provider details.');
      return res.status(502).json({ error: 'تعذّر إكمال التحليل السحابي. يمكنك إدخال البيانات يدويًا أو المحاولة لاحقًا.' });
    } finally {
      releaseAiRequest(res);
    }
  });

  // 5. AI Endodontic Working Length Assistant
  app.post('/api/ai/endodontic-helper', async (req, res) => {
    try {
      const { imageBase64, toothNumber, mimeType } = req.body;
      const ai = getGeminiClient();

      if (!imageBase64) return res.status(400).json({ error: 'أرفق صورة للتحليل.' });
      if (!ai) {
        return res.status(503).json({ error: 'خدمة تحليل الصور غير مفعّلة. يمكنك إدخال البيانات يدويًا حتى يتم إعداد الخدمة.' });
      }

      const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

      const response = await ai.models.generateContent({
        model: env.GEMINI_MODEL || 'gemini-3.6-flash',
        contents: {
          parts: [
            {
              inlineData: {
                data: cleanBase64,
                mimeType,
              },
            },
            {
              text: `أنت مساعد علاج جذور الأسنان (Endodontics Specialist). قم بتحليل صورة الأشعة أو قياسات طول العمل (Working Length) للسن رقم ${toothNumber || 'الحالي'}.
حدد الأقنية الجذور المحتملة (MB, DB, Palatal, Distal, Lingual...)، والاطوال المقدرة بالملم، وتوصية حد الذروة (Apical Reference).`,
            },
          ],
        },
        config: {
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              toothNumber: { type: Type.STRING },
              canals: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    estimatedLengthMm: { type: Type.NUMBER },
                    confidence: { type: Type.STRING },
                  },
                },
              },
              apicalLimitNote: { type: Type.STRING },
              recommendation: { type: Type.STRING },
            },
          },
        },
      });

      const resultText = response.text || '{}';
      if (resultText.length > 512 * 1024) throw new Error('AI response exceeds limit');
      const parsed = JSON.parse(resultText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid AI response');
      return res.json({ ...parsed, autoCleanupFlag: true });
    } catch (err: any) {
      console.warn('AI request failed without exposing provider details.');
      return res.status(502).json({ error: 'تعذّر إكمال التحليل السحابي. يمكنك إدخال البيانات يدويًا أو المحاولة لاحقًا.' });
    } finally {
      releaseAiRequest(res);
    }
  });

  // 6. AI Daily Clinic Summary & Smart Assistant Alerts
  app.post('/api/ai/clinical-summary', async (req, res) => {
    try {
      const { appointmentsCount, totalRevenue, pendingFollowUps, totalDebt, newPatientsCount } = req.body;
      const ai = getGeminiClient();

      if (!ai) {
        return res.json({
          dailyBrief: `ملخص العيادة اليوم: تم استقبال ${appointmentsCount} مريض وتسجيل ${newPatientsCount} مريض جديد. إجمالي تحصيلات اليوم ${totalRevenue} ج.م.`,
          alerts: [
            pendingFollowUps > 0 ? `يوجد ${pendingFollowUps} حالات متابعة تحتاج تأكيد مواعيد.` : 'لا توجد مواعيد متابعة متأخرة اليوم.',
            totalDebt > 0 ? `إجمالي المبالغ المتبقية على المرضى: ${totalDebt} ج.م.` : 'جميع الحسابات مستوفاة.',
          ],
        });
      }

      const response = await ai.models.generateContent({
        model: env.GEMINI_MODEL || 'gemini-3.6-flash',
        contents: `اكتب موجزاً تنفيذياً ذكياً ومختصراً لطبيب الأسنان عن نشاط العيادة اليوم باللغة العربية:
عدد المواعيد: ${appointmentsCount}
المرضى الجدد: ${newPatientsCount}
إجمالي التحصيل اليومي: ${totalRevenue} ج.م
حالات المتابعة المعلقة: ${pendingFollowUps}
المبالغ المتبقية الآجلة: ${totalDebt} ج.م`,
        config: {
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              dailyBrief: { type: Type.STRING },
              alerts: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
          },
        },
      });

      const resultText = response.text || '{}';
      if (resultText.length > 512 * 1024) throw new Error('AI response exceeds limit');
      const parsed = JSON.parse(resultText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid AI response');
      return res.json(parsed);
    } catch (err: any) {
      console.warn('AI request failed without exposing provider details.');
      return res.status(502).json({ error: 'تعذّر إكمال التحليل السحابي. يمكنك إدخال البيانات يدويًا أو المحاولة لاحقًا.' });
    } finally {
      releaseAiRequest(res);
    }
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'المسار غير متاح.' }));
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error?.type === 'entity.too.large' ? 413 : 400;
    res.status(status).json({ error: status === 413 ? 'حجم الطلب كبير جدًا. استخدم صورة أقل من ٢ ميجابايت.' : 'بيانات الطلب غير صالحة.' });
  });
  return app;
}

export function mountProductionWebsite(app: express.Express, distPath: string): void {
  // Defense in depth for old/misconfigured builds: source and server artifacts
  // are never public, even if accidentally copied into the static directory.
  app.use((req, res, next) => {
    let pathname: string;
    try { pathname = decodeURIComponent(req.path); } catch { return void res.sendStatus(400); }
    if (/\.(?:cjs|map|ts|tsx|json|json5|yaml|yml|pem|key|lock)[ .]*$/i.test(pathname) || /(?:^|\/)(?:\.env(?:\.|$)|server(?:\.|$))/i.test(pathname)) return void res.sendStatus(404);
    next();
  });
  app.use(express.static(distPath, { dotfiles: 'deny', index: 'index.html' }));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

export async function startServer() {
  const app = createApiApp();
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  if (process.env.NODE_ENV !== 'production') {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    mountProductionWebsite(app, path.resolve(process.cwd(), 'dist'));
  }
  // Local development is loopback-only. Deployment must explicitly opt in.
  const host = process.env.HOST || '127.0.0.1';
  return app.listen(port, host, () => console.log(`Dental Clinic server: http://${host}:${port} (${process.env.NODE_ENV || 'development'})`));
}
