import React from 'react';
import type { PrescriptionImageData } from '../../utils/prescriptionImage';
import {normalizePrescriptionDesign, prescriptionContrastColor} from '../../utils/prescriptionTemplate';

// One paper, not a second canvas drawing: the exact DOM below is printed AND
// rasterized. Inline, system-font styles make it independent of the viewport,
// Tailwind breakpoints, custom web fonts and surrounding financial UI.
const ink = '#1a4388', gold = '#c59d5f';
const text: React.CSSProperties = { overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' };
const arabic: React.CSSProperties = { direction: 'rtl', textAlign: 'right', unicodeBidi: 'isolate' };
const latin: React.CSSProperties = { direction: 'ltr', textAlign: 'left', unicodeBidi: 'isolate' };
const tooth = (watermark = false, ink = '#1a4388', gold = '#c59d5f') => <svg xmlns="http://www.w3.org/2000/svg" width={watermark ? 180 : 52} height={watermark ? 180 : 52} style={{ width: watermark ? 180 : 52, height: watermark ? 180 : 52, display: 'block', flexShrink: 0, margin: watermark ? '0 auto' : 0, transform: 'none' }} viewBox="0 0 100 100" fill="none" aria-hidden="true">
  <path d="M25 20 C35 10,45 22,50 25 C55 22,65 10,75 20 C85 30,85 50,80 65 C76 77,65 92,58 92 C54 92,53 82,50 82 C47 82,46 92,42 92 C35 92,24 77,20 65 C15 50,15 30,25 20 Z" stroke={ink} strokeWidth={watermark ? 3 : 6} strokeLinecap="round" strokeLinejoin="round" />
  <path d="M32 35 L42 75 L50 48 L58 75 L68 35" stroke={gold} strokeWidth={watermark ? 3 : 5} strokeLinecap="round" strokeLinejoin="round" />
</svg>;

export function createPrescriptionDocument(data: PrescriptionImageData, ref?: React.Ref<HTMLDivElement>) {
  const design = normalizePrescriptionDesign(data.design), ink = design.primaryColor, gold = design.accentColor;
  const fontDelta = design.fontSize - 12;
  return <div id="printable-prescription" data-prescription-document="v2" ref={ref} dir="rtl" style={{
    boxSizing: 'border-box', width: '148mm', minHeight: '210mm', padding: '6mm', margin: 0,
    backgroundColor: '#ffffff', color: '#253748', fontFamily: design.fontFamily === 'Tahoma' ? 'Tahoma, Arial, sans-serif' : 'Arial, Tahoma, sans-serif',
    fontSize: design.fontSize, lineHeight: 1.6, display: 'flex', flexDirection: 'column', position: 'relative',
    ...text, ...arabic,
  }}>
    <div data-prescription-header={design.logoPosition === 'left' ? 'arabic-right-logo-left' : 'arabic-left-logo-right'} style={{ display: 'flex', flexDirection: design.logoPosition === 'left' ? 'row' : 'row-reverse', alignItems: 'center', gap: 12, direction: 'rtl', paddingBottom: 14, borderBottom: '2px solid #d9e7e6' }}>
      <div dir="rtl" style={{ flex: 1.1, minWidth: 0, color: design.headerStyle === 'filled' ? prescriptionContrastColor(design.headerColor) : design.headerColor, backgroundColor: design.headerStyle === 'filled' ? design.headerColor : '#ffffff', border: design.headerStyle === 'outline' ? `1px solid ${design.headerColor}` : undefined, borderRadius: 12, padding: '10px 12px', ...arabic }}>
        <div style={{ fontSize: 11 + fontDelta }}>{data.doctorTitle}</div>
        <div style={{ fontSize: 19 + fontDelta, fontWeight: 800 }}>{data.doctorName}</div>
        {data.specialties.map((value, index) => <div key={index} style={{ fontSize: (index ? 10 : 11) + fontDelta }}>{value}</div>)}
      </div>
      <div dir="ltr" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, ...latin }}>
        {design.showLogo && (data.clinicLogo ? <img src={data.clinicLogo} alt={data.clinicName} className="rx-identity-logo" width="64" height="64" style={{ width: 64, height: 64, objectFit: 'contain', transform: 'none', flexShrink: 0 }} /> : tooth(false, ink, gold))}
        <strong dir="ltr" style={{ color: ink, fontSize: 13, textAlign: 'center', ...text, unicodeBidi: 'isolate' }}>{data.doctorEnglish}</strong>
      </div>
    </div>
    <div style={{ border: `1px solid ${gold}`, borderRadius: 12, padding: '9px 12px', marginTop: 14, color: ink, backgroundColor: '#fffcf5', fontWeight: 700 }}>
      <div>الاسم: <bdi dir="auto" style={{ color: '#253748' }}>{data.patientName}</bdi></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 4 }}>
        <span style={{ minWidth: 0 }}>السن: <bdi style={{ color: '#253748' }}>{data.age}</bdi> سنة</span>
        <span style={{ minWidth: 0 }}>التاريخ: <bdi dir="ltr" style={{ color: '#253748', ...latin }}>{data.date}</bdi></span>
      </div>
    </div>
    <div style={{ position: 'relative', flex: 1, minHeight: 330, margin: '12px 0' }}>
      {design.showWatermark && <div style={{ position: 'absolute', top: 100, left: 0, width: '100%', textAlign: 'center', opacity: 0.06, pointerEvents: 'none' }}>
        {tooth(true, ink, gold)}<div dir="ltr" style={{ color: ink, fontFamily: 'Georgia, serif', fontWeight: 700 }}>{data.doctorEnglish} Dental Clinic</div>
      </div>}
      <div style={{ position: 'relative' }}>
        <div dir="ltr" style={{ color: ink, fontFamily: 'Georgia, serif', fontSize: 36, fontWeight: 800, paddingLeft: 6, ...latin }}>℞</div>
        {data.items.length ? data.items.map((item, index) => <div key={item.id} style={{ padding: design.spacing === 'compact' ? '6px 8px' : '10px 8px', borderBottom: '1px solid #e2e8f0', breakInside: 'avoid' }}>
          <div dir="ltr" style={{ display: 'flex', alignItems: 'baseline', gap: 7, fontSize: 15 + fontDelta, fontWeight: 800, ...latin }}>
            <span dir="ltr" style={{ color: ink, flexShrink: 0 }}>{index + 1}.</span>
            <bdi dir="auto" style={{ flex: 1, minWidth: 0, textAlign: 'start', ...text }}>{item.drugName}</bdi>
          </div>
          <div dir="auto" style={{ marginTop: 4, paddingInlineStart: 20, fontSize: 13 + fontDelta, textAlign: 'start', unicodeBidi: 'isolate', ...text }}><bdi dir="auto">{item.dosage}</bdi>{item.duration && <span> (<bdi dir="auto">{item.duration}</bdi>)</span>}</div>
        </div>) : <p style={{ color: '#64748b', textAlign: 'center', padding: '32px 0' }}>لم يتم إضافة أية أدوية بعد. اختر من الفهرس أو أضف دواء مخصص.</p>}
        {data.diagnosis && <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 10, border: '1px solid #c7d2fe', backgroundColor: '#eef2ff', ...text }}><strong>التشخيص: </strong>{data.diagnosis}</div>}
        {data.notes && <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 10, border: '1px solid #fde68a', backgroundColor: '#fffbeb', ...text }}><strong>إرشادات الطبيب: </strong>{data.notes}</div>}
      </div>
    </div>
    <div style={{ marginTop: 12, breakInside: 'avoid' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: ink, marginBottom: 8 }}><strong style={{ minWidth: 0, ...text }}>{data.clinicName}</strong>{design.showFileNo && <span style={{ minWidth: 0, color: '#64748b', fontSize: 11, ...text }}>ملف <bdi dir="ltr">#{data.fileNo}</bdi></span>}</div>
      <div style={{ backgroundColor: ink, color: prescriptionContrastColor(ink), padding: '10px 12px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 14 }}>
        <strong dir="ltr" style={{ fontSize: 14, minWidth: 0, flex: '0 1 40%', ...text, ...latin }}>{data.phone}</strong>
        <span dir="rtl" style={{ fontSize: 11, minWidth: 0, flex: 1, ...text, ...arabic }}>{data.address}</span>
      </div>
      {design.footerNote && <div style={{ marginTop: 8, textAlign: 'center', fontSize: 11 + fontDelta, color: '#475569', ...text }}>{design.footerNote}</div>}
    </div>
  </div>;
}
