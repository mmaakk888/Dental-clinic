export interface PrescriptionDesign {
  primaryColor: string; accentColor: string; headerColor: string;
  fontFamily: 'Arial' | 'Tahoma'; fontSize: 12 | 13 | 14;
  logoPosition: 'left' | 'right'; headerStyle: 'filled' | 'outline';
  showLogo: boolean; showWatermark: boolean; showFileNo: boolean;
  spacing: 'comfortable' | 'compact'; footerNote: string;
}
export interface PrescriptionTemplate {
  header: {doctorTitle: string; doctorName: string; doctorEnglish: string; specialty1: string; specialty2: string; phone: string; address: string};
  design: PrescriptionDesign;
}
export const DEFAULT_PRESCRIPTION_DESIGN: Readonly<PrescriptionDesign> = Object.freeze({
  primaryColor: '#1a4388', accentColor: '#c59d5f', headerColor: '#165954', fontFamily: 'Arial', fontSize: 12,
  logoPosition: 'left', headerStyle: 'filled', showLogo: true, showWatermark: true, showFileNo: true,
  spacing: 'comfortable', footerNote: '',
});
const safeText = (value: unknown, limit: number) => typeof value === 'string' && Array.from(value).length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? value : '';
/** Legacy records have no design. Never reinterpret them using today's template. */
export function normalizePrescriptionDesign(value?: unknown): PrescriptionDesign {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const next = {...DEFAULT_PRESCRIPTION_DESIGN};
  for (const key of ['primaryColor', 'accentColor', 'headerColor'] as const) if (typeof input[key] === 'string' && /^#[0-9a-f]{6}$/i.test(input[key] as string)) next[key] = input[key] as string;
  if (input.fontFamily === 'Arial' || input.fontFamily === 'Tahoma') next.fontFamily = input.fontFamily;
  if (input.fontSize === 12 || input.fontSize === 13 || input.fontSize === 14) next.fontSize = input.fontSize;
  if (input.logoPosition === 'left' || input.logoPosition === 'right') next.logoPosition = input.logoPosition;
  if (input.headerStyle === 'filled' || input.headerStyle === 'outline') next.headerStyle = input.headerStyle;
  if (input.spacing === 'comfortable' || input.spacing === 'compact') next.spacing = input.spacing;
  for (const key of ['showLogo', 'showWatermark', 'showFileNo'] as const) if (typeof input[key] === 'boolean') next[key] = input[key];
  next.footerNote = safeText(input.footerNote, 300);
  return next;
}
export function normalizePrescriptionTemplate(value?: unknown, legacyHeader?: {doctorName?: string; phone?: string; address?: string}): PrescriptionTemplate {
  const input = value && typeof value === 'object' ? value as Partial<PrescriptionTemplate> : {};
  const header = input.header && typeof input.header === 'object' ? input.header : {} as PrescriptionTemplate['header'];
  return {header: {
    doctorTitle: safeText(header.doctorTitle ?? 'دكتور', 500), doctorName: safeText(header.doctorName ?? legacyHeader?.doctorName ?? '', 500),
    doctorEnglish: safeText(header.doctorEnglish, 500), specialty1: safeText(header.specialty1 ?? 'طب وجراحة الفم والأسنان', 500),
    specialty2: safeText(header.specialty2 ?? 'تقويم وتجميل الأسنان', 500), phone: safeText(header.phone ?? legacyHeader?.phone ?? '', 500), address: safeText(header.address ?? legacyHeader?.address ?? '', 500),
  }, design: normalizePrescriptionDesign(input.design)};
}
export function validatePrescriptionTemplate(value: PrescriptionTemplate): void {
  if (JSON.stringify(normalizePrescriptionTemplate(value)) !== JSON.stringify(value)) throw Error('راجع قيم تصميم الروشتة؛ لا تُقبل أكواد HTML أو CSS أو قيم خارج الخيارات المتاحة.');
}
/** Pick readable text without changing the selected identity colour. */
export function prescriptionContrastColor(hex: string): string {
  const rgb = hex.slice(1).match(/../g)!.map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2] > .179 ? '#152536' : '#ffffff';
}
