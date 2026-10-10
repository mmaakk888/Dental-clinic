import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { capturePrescriptionPaper, isEmbeddedPrescriptionLogo, prescriptionCaptureSize, prescriptionPaperMarkup, renderPrescriptionImage, sharePrescriptionImage, validatePrescriptionImageData } from './prescriptionImage';
import type { PrescriptionImageData } from './prescriptionImage';
+test('Rx sharing uses only the prepared image, respects denial/cancellation and never claims WhatsApp delivery', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const file = new File(['synthetic-png'], 'synthetic-prescription.png', { type: 'image/png' });
  const payloads: any[] = [];
  const install = (value: unknown) => Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
  try {
    install({}); assert.equal(await sharePrescriptionImage(file, true, () => {}), 'unsupported');
    install({ canShare: () => false, share: async (payload: any) => payloads.push(payload) });
    assert.equal(await sharePrescriptionImage(file, true, () => {}), 'unsupported'); assert.equal(payloads.length, 0);
    install({ canShare: () => true, share: async (payload: any) => payloads.push(payload) });
    await assert.rejects(sharePrescriptionImage(file, false, () => {}));
    await assert.rejects(sharePrescriptionImage(file, true, () => { throw new Error('synthetic-denied'); }));
    assert.equal(payloads.length, 0);
    assert.equal(await sharePrescriptionImage(file, true, () => {}), 'shared');
    assert.deepEqual(payloads[0], { files: [file], title: 'روشتة طبية' });
    install({ canShare: () => true, share: async () => { throw new DOMException('cancelled', 'AbortError'); } });
    assert.equal(await sharePrescriptionImage(file, true, () => {}), 'cancelled');
    install({ canShare: () => true, share: async () => { throw new Error('PRIVATE_PROVIDER_ERROR'); } });
    await assert.rejects(sharePrescriptionImage(file, true, () => {}), error => error instanceof Error && /إرفاقها يدويًا/.test(error.message) && !/PRIVATE/.test(error.message));
  } finally { if (original) Object.defineProperty(globalThis, 'navigator', original); else Reflect.deleteProperty(globalThis, 'navigator'); }
});

// Actual shared template, synthetic DOM/capture only. No browser/live records.
const fixture = (): PrescriptionImageData => ({ clinicName: 'عيادة اختبار', clinicLogo: null,
  doctorTitle: 'طبيب أسنان', doctorName: 'طبيب مصطنع', doctorEnglish: 'Synthetic Dentist',
  specialties: ['بيانات اختبار فقط'], phone: '01000000000', address: 'عنوان مصطنع', patientName: 'مريض مصطنع', fileNo: '501', age: 30, date: '2026-10-10', diagnosis: 'تشخيص مصطنع',
  items: [{ id: 'synthetic-drug', drugName: 'Synthetic drug', dosage: 'جرعة اختبار ليست للاستخدام الطبي', duration: 'مدة مصطنعة' }], notes: 'تعليمات اختبار فقط' });
const built = buildSync({ stdin: { resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx', contents: `import {renderToStaticMarkup} from 'react-dom/server'; import {createPrescriptionDocument} from './src/components/patient/PrescriptionDocument'; export const render = data => renderToStaticMarkup(createPrescriptionDocument(data));` }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', logLevel: 'silent' });
const compiled = { exports: {} as { render(data: PrescriptionImageData): string } };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
test('canonical print paper includes logo, banner, watermark, full clinical text and viewport-independent A5 geometry', () => {
  const data = fixture(); data.notes = 'سطر أول\n' + 'تعليمات مصطنعة '.repeat(60);
  const html = compiled.exports.render(data);
  for (const value of [data.patientName, data.doctorEnglish, data.items[0].drugName, data.items[0].dosage, data.items[0].duration, data.notes, data.diagnosis, data.phone, data.address]) assert.ok(html.includes(value));
  assert.match(html, /data-prescription-document="v2"/); assert.match(html, /width:148mm;min-height:210mm;padding:6mm/);
  assert.match(html, /background-color:#165954/); assert.match(html, /opacity:0.06/); assert.match(html, /<svg[^>]+viewBox="0 0 100 100"/);
  assert.doesNotMatch(html, /المتبقي|التكلفة|التحصيل|المعمل|<button|<input|ellipsis/);
  const logo = 'data:image/png;base64,c3ludGhldGlj'; const custom = compiled.exports.render({ ...data, clinicLogo: logo });
  assert.ok(custom.includes(logo)); assert.match(custom, /object-fit:contain;transform:none/);
  const escaped = compiled.exports.render({ ...data, patientName: '<script>synthetic</script>' });
  assert.doesNotMatch(escaped, /<script>/); assert.match(escaped, /&lt;script&gt;/);
});
test('canonical Rx separates Arabic identity, unchanged logo and numbered mixed-language content without mirroring', () => {
  const data = fixture();
  data.items = [
    { id: 'rtl-test', drugName: 'دواء مصطنع 250 mg', dosage: 'جرعة اختبار 1/2 — ليست وصفة', duration: 'Synthetic 5 days' },
    { id: 'ltr-test', drugName: 'Synthetic medicine 500 mg', dosage: 'Synthetic only مرتان يوميًا', duration: '٣ أيام مصطنعة' },
  ];
  data.clinicLogo = 'data:image/png;base64,c3ludGhldGlj';
  const html = compiled.exports.render(data);
  assert.match(html, /data-prescription-header="arabic-right-logo-left"/);
  assert.ok(html.indexOf(data.doctorName) < html.indexOf('class="rx-identity-logo"'));
  assert.match(html, /object-fit:contain;transform:none/);
  assert.match(html, /unicode-bidi:isolate/);
  assert.match(html, /<bdi dir="ltr">#501<\/bdi>/);
  assert.match(html, /<bdi dir="ltr"[^>]+>2026-10-10<\/bdi>/);
  assert.match(html, /<bdi dir="auto"[^>]+>دواء مصطنع 250 mg<\/bdi>/);
  for (const item of data.items) for (const value of [item.drugName, item.dosage, item.duration]) assert.ok(html.includes(value));
  assert.doesNotMatch(html, /scaleX|rotateY|transform:scale\(-/);
});
test('image validation rejects empty drugs, remote logos and excessive text instead of dropping it', () => {
  assert.throws(() => validatePrescriptionImageData({ ...fixture(), items: [] }), /أضف الأدوية/);
  assert.throws(() => validatePrescriptionImageData({ ...fixture(), items: [{ ...fixture().items[0], drugName: ' ' }] }));
  assert.throws(() => validatePrescriptionImageData({ ...fixture(), notes: 'X'.repeat(8001) }), /لم يتم حذف أي نص/);
  assert.throws(() => validatePrescriptionImageData({ ...fixture(), items: Array.from({ length: 101 }, (_, i) => ({ ...fixture().items[0], id: String(i) })) }));
  for (const logo of ['https://example.invalid/logo.png', 'data:image/svg+xml;base64,c3ludGhldGlj', 'javascript:synthetic']) assert.throws(() => validatePrescriptionImageData({ ...fixture(), clinicLogo: logo }), /ارفع شعار/);
  assert.equal(isEmbeddedPrescriptionLogo('data:image/webp;base64,c3ludGhldGlj'), true);
  assert.deepEqual(prescriptionCaptureSize(559.4, 793.8), { width: 560, height: 794, scale: 2 });
  for (const h of [NaN, Infinity, -1, 4097]) assert.throws(() => prescriptionCaptureSize(560, h), /لم يتم حذف أي نص/);
});
const node = (tagName = 'DIV', attributes: Record<string, string> = {}, children: any[] = []): any => ({ tagName, id: attributes.id || '', outerHTML: '<div>synthetic canonical paper</div>', attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })), getAttribute: (name: string) => attributes[name] || null, querySelectorAll: () => children });
const paper = (children: any[] = []) => node('DIV', { id: 'printable-prescription', 'data-prescription-document': 'v2' }, children);
test('capture accepts only paper and embedded assets, not controls, scripts or foreign requests', () => {
  assert.equal(prescriptionPaperMarkup(paper()), '<div>synthetic canonical paper</div>'); assert.throws(() => prescriptionPaperMarkup(node()));
  for (const child of [node('SCRIPT'), node('IFRAME'), node('INPUT'), node('IMG', { src: 'https://example.invalid' }), node('DIV', { style: 'background:url(https://example.invalid)' }), node('DIV', { onclick: 'synthetic' }), node('path', { href: 'https://example.invalid' })]) assert.throws(() => prescriptionPaperMarkup(paper([child])));
  assert.doesNotThrow(() => prescriptionPaperMarkup(paper([node('IMG', { src: 'data:image/png;base64,c3ludGhldGlj' }), node('svg'), node('path')])));
});
function isolated(images: any[] = []) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document'); let removed = 0, appended = 0, callback: BlobCallback | undefined;
  const source = { offsetWidth: 560, scrollWidth: 560, scrollHeight: 794, querySelectorAll: () => images };
  const frame: any = { style: {}, attributes: {}, contentDocument: { getElementById: () => source }, setAttribute(name: string, value: string) { this.attributes[name] = value; }, remove() { removed++; } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement(name: string) { assert.equal(name, 'iframe'); return frame; }, body: { appendChild() { appended++; queueMicrotask(() => frame.onload()); } } } });
  const capture = async (actual: unknown, options: any) => { assert.equal(actual, source); assert.equal(options.scale, 2); assert.equal(options.useCORS, false); assert.equal(options.allowTaint, false); return { toBlob(next: BlobCallback, type: string) { assert.equal(type, 'image/png'); callback = next; } } as HTMLCanvasElement; };
  return { frame, source, capture, get removed() { return removed; }, get appended() { return appended; },
    async encode() { for (let i = 0; i < 10 && !callback; i++) await Promise.resolve(); assert.ok(callback); callback(new Blob(['synthetic'], { type: 'image/png' })); },
    restore() { if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document'); } };
}
test('capture isolates Rx in an offline scriptless document and removes temporary DOM', async () => {
  const h = isolated(); try { const pending = capturePrescriptionPaper('<div>synthetic</div>', h.capture, true, () => {}); await h.encode(); assert.equal((await pending).type, 'image/png'); assert.equal(h.removed, 1); assert.equal(h.frame.attributes.sandbox, 'allow-same-origin'); assert.match(h.frame.srcdoc, /default-src 'none'; img-src data:/); assert.match(h.frame.srcdoc, /<body><div>synthetic<\/div><\/body>/); assert.doesNotMatch(h.frame.srcdoc, /script src|https?:\/\//); } finally { h.restore(); }
});
test('fresh authorization before work and after encoding prevents revoked image output', async () => {
  const h = isolated(); let allowed = true;
  try { await assert.rejects(renderPrescriptionImage(fixture(), false, () => {}, paper())); await assert.rejects(renderPrescriptionImage(fixture(), true, undefined, paper())); await assert.rejects(renderPrescriptionImage({ ...fixture(), clinicLogo: 'https://example.invalid' }, true, () => {}, paper())); assert.equal(h.appended, 0);
    const pending = capturePrescriptionPaper('synthetic', h.capture, true, () => { if (!allowed) throw new Error('synthetic-revoked'); });
    // Let capture finish, revoke while PNG encoding is outstanding.
    for (let i = 0; i < 6; i++) await Promise.resolve(); allowed = false; await h.encode(); await assert.rejects(pending, /synthetic-revoked/); assert.equal(h.removed, 1);
  } finally { h.restore(); }
});
test('broken logo and oversized paper fail explicitly without publishing incomplete images', async () => {
  const h = isolated([{ complete: false, naturalWidth: 0, naturalHeight: 0 }]); try { await assert.rejects(capturePrescriptionPaper('synthetic', h.capture, true, () => {}), /شعار الروشتة/); assert.equal(h.removed, 1); } finally { h.restore(); }
  const large = isolated(); large.source.scrollHeight = 4097; try { await assert.rejects(capturePrescriptionPaper('synthetic', large.capture, true, () => {}), /لم يتم حذف أي نص/); assert.equal(large.removed, 1); } finally { large.restore(); }
  const wide = isolated(); wide.source.scrollWidth = 600; try { await assert.rejects(capturePrescriptionPaper('synthetic', wide.capture, true, () => {}), /يتجاوز عرض/); assert.equal(wide.removed, 1); } finally { wide.restore(); }
});
