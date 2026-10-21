import type { PrescriptionItem } from '../types';
import { requireAuthorizedDataOutput } from './authorizedDataOutput';

export interface PrescriptionImageData {
  clinicName: string; clinicLogo: string | null;
  doctorTitle: string; doctorName: string; doctorEnglish: string; specialties: string[];
  phone: string; address: string; patientName: string; fileNo: string; age: number; date: string;
  diagnosis: string; items: PrescriptionItem[]; notes: string;
}
/** Validate complete clinical text before capture; never silently truncate it. */
export function validatePrescriptionImageData(data: PrescriptionImageData): void {
  if (!data.items.length || data.items.length > 100 || data.items.some(item => !item.drugName.trim())) throw new Error('أضف الأدوية وراجع أسماءها قبل تجهيز الصورة.');
  const values = [data.patientName, data.fileNo, data.date, data.doctorTitle, data.clinicName, data.doctorName, data.doctorEnglish,
    data.notes, data.diagnosis, data.phone, data.address, ...data.specialties, ...data.items.flatMap(item => [item.drugName, item.dosage, item.duration])];
  if (values.some(value => typeof value !== 'string' || value.length > 8000)) throw new Error('الروشتة طويلة جدًا. قسّمها على أكثر من روشتة؛ لم يتم حذف أي نص.');
  if (data.clinicLogo && !isEmbeddedPrescriptionLogo(data.clinicLogo)) throw new Error('لإظهار الشعار في الصورة، ارفع شعار PNG أو JPG أو WebP من الهوية والمظهر.');
}

export function isEmbeddedPrescriptionLogo(source: string): boolean {
  return source.length <= 6_000_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(source);
}

export function prescriptionCaptureSize(width: number, height: number) {
  // 2x A5 is readable but remains below common mobile canvas memory limits.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 500 || width > 600 || height < 700 || height > 4096) {
    throw new Error('الروشتة أطول من صورة واضحة واحدة. قسّمها على أكثر من روشتة؛ لم يتم حذف أي نص.');
  }
  return { width: Math.ceil(width), height: Math.ceil(height), scale: 2 };
}

/** Only the reviewed paper enters an isolated, scriptless, offline document. */
export function prescriptionPaperMarkup(paper: HTMLElement): string {
  if (paper.id !== 'printable-prescription' || paper.getAttribute('data-prescription-document') !== 'v2') throw new Error('افتح معاينة الروشتة أولًا.');
  const permitted = new Set(['DIV', 'SPAN', 'STRONG', 'P', 'BDI', 'IMG', 'svg', 'path']);
  for (const node of [paper, ...Array.from(paper.querySelectorAll('*'))]) {
    if (!permitted.has(node.tagName)) throw new Error('تعذّر تجهيز قالب الروشتة.');
    for (const attribute of Array.from(node.attributes)) {
      if (/^on/i.test(attribute.name) || /^(href|xlink:href|srcset)$/i.test(attribute.name) ||
        (attribute.name === 'style' && /url\s*\(/i.test(attribute.value))) throw new Error('تعذّر تجهيز قالب الروشتة.');
    }
    if (node.tagName === 'IMG' && !isEmbeddedPrescriptionLogo(node.getAttribute('src') || '')) throw new Error('ارفع شعار PNG أو JPG أو WebP من الهوية والمظهر.');
  }
  return paper.outerHTML;
}

type Capture = (paper: HTMLElement, options: Record<string, unknown>) => Promise<HTMLCanvasElement>;
/** Capture the actual print DOM, not an independent interpretation of its data. */
export async function capturePrescriptionPaper(markup: string, capture: Capture, allowed: boolean, authorize?: () => void): Promise<Blob> {
  requireAuthorizedDataOutput(allowed, authorize);
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:560px;height:794px;border:0;pointer-events:none;opacity:0';
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('تعذّر تجهيز معاينة الصورة.')), 6000);
      frame.onload = () => { clearTimeout(timer); resolve(); };
      frame.onerror = () => { clearTimeout(timer); reject(new Error('تعذّر تجهيز معاينة الصورة.')); };
      frame.srcdoc = '<!doctype html><html dir="rtl"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><style>html,body{margin:0;padding:0;background:#fff}*{box-sizing:border-box}</style></head><body>' + markup + '</body></html>';
      document.body.appendChild(frame);
    });
    requireAuthorizedDataOutput(allowed, authorize);
    const paper = frame.contentDocument?.getElementById('printable-prescription');
    if (!paper) throw new Error('تعذّر تجهيز قالب الروشتة.');
    for (const image of Array.from(paper.querySelectorAll('img'))) {
      if (image.decode) await image.decode().catch(() => { throw new Error('صورة شعار الروشتة غير صالحة.'); });
      if (!image.complete || !image.naturalWidth || !image.naturalHeight) throw new Error('صورة شعار الروشتة غير صالحة.');
    }
    if (paper.scrollWidth > paper.offsetWidth + 1) throw new Error('يوجد نص يتجاوز عرض الروشتة. راجعه قبل تجهيز الصورة؛ لم يتم حذف أي نص.');
    const size = prescriptionCaptureSize(paper.offsetWidth, paper.scrollHeight);
    const canvas = await capture(paper, {
      ...size, backgroundColor: '#ffffff', logging: false, allowTaint: false, useCORS: false,
      foreignObjectRendering: false, imageTimeout: 5000, removeContainer: true,
      windowWidth: 560, windowHeight: Math.max(794, size.height), scrollX: 0, scrollY: 0,
    });
    requireAuthorizedDataOutput(allowed, authorize);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
      try { requireAuthorizedDataOutput(allowed, authorize); if (!blob) throw new Error('تعذّر تجهيز صورة الروشتة.'); resolve(blob); }
      catch (error) { reject(error); }
    }, 'image/png'));
  } finally { frame.remove(); }
}

export async function renderPrescriptionImage(data: PrescriptionImageData, allowed: boolean, authorize?: () => void, paper?: HTMLElement | null): Promise<Blob> {
  requireAuthorizedDataOutput(allowed, authorize);
  validatePrescriptionImageData(data);
  if (!paper) throw new Error('افتح معاينة الروشتة أولًا.');
  const markup = prescriptionPaperMarkup(paper);
  const { default: html2canvas } = await import('html2canvas');
  requireAuthorizedDataOutput(allowed, authorize);
  return capturePrescriptionPaper(markup, html2canvas, allowed, authorize);
}

/** Call directly from a click with a prepared file; native sharing needs user activation. */
export async function sharePrescriptionImage(file: File, allowed: boolean, authorize?: () => void): Promise<'shared' | 'unsupported' | 'cancelled'> {
  requireAuthorizedDataOutput(allowed, authorize);
  if (!navigator.share || !navigator.canShare?.({ files: [file] })) return 'unsupported';
  try { await navigator.share({ files: [file], title: 'روشتة طبية' }); return 'shared'; }
  catch (error) { if (error instanceof Error && error.name === 'AbortError') return 'cancelled'; throw new Error('تعذّرت مشاركة الصورة؛ يمكنك تنزيلها وإرفاقها يدويًا في واتساب.'); }
}
