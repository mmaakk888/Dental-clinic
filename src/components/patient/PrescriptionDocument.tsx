import React from 'react';
import type { PrescriptionImageData } from '../../utils/prescriptionImage';

// One paper, not a second canvas drawing: the exact DOM below is printed AND
// rasterized. Inline, system-font styles make it independent of the viewport,
// Tailwind breakpoints, custom web fonts and surrounding financial UI.
const ink = '#1a4388', gold = '#c59d5f';
const text: React.CSSProperties = { overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' };
const tooth = (watermark = false) => <svg xmlns="http://www.w3.org/2000/svg" width={watermark ? 180 : 52} height={watermark ? 180 : 52} style={{ width: watermark ? 180 : 52, height: watermark ? 180 : 52, display: 'block', flexShrink: 0, margin: watermark ? '0 auto' : 0 }} viewBox="0 0 100 100" fill="none" aria-hidden="true">
  <path d="M25 20 C35 10,45 22,50 25 C55 22,65 10,75 20 C85 30,85 50,80 65 C76 77,65 92,58 92 C54 92,53 82,50 82 C47 82,46 92,42 92 C35 92,24 77,20 65 C15 50,15 30,25 20 Z" stroke={ink} strokeWidth={watermark ? 3 : 6} strokeLinecap="round" strokeLinejoin="round" />
  <path d="M32 35 L42 75 L50 48 L58 75 L68 35" stroke={gold} strokeWidth={watermark ? 3 : 5} strokeLinecap="round" strokeLinejoin="round" />
</svg>;

export function createPrescriptionDocument(data: PrescriptionImageData, ref?: React.Ref<HTMLDivElement>) {
  return <div id="printable-prescription" data-prescription-document="v2" ref={ref} dir="rtl" style={{
    boxSizing: 'border-box', width: '148mm', minHeight: '210mm', padding: '6mm', margin: 0,
    backgroundColor: '#ffffff', color: '#253748', fontFamily: 'Arial, Tahoma, sans-serif',
    fontSize: 12, lineHeight: 1.6, display: 'flex', flexDirection: 'column', position: 'relative',
    ...text,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, direction: 'ltr', paddingBottom: 14, borderBottom: '2px solid #d9e7e6' }}>
      <div dir="ltr" style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        {data.clinicLogo ? <img src={data.clinicLogo} alt={data.clinicName} className="rx-identity-logo" width="52" height="52" style={{ width: 52, height: 52, objectFit: 'contain', transform: 'none', flexShrink: 0 }} /> : tooth()}
        <strong dir="ltr" style={{ color: ink, fontSize: 14, ...text }}>{data.doctorEnglish}</strong>
      </div>
      <div dir="rtl" style={{ flex: 1.1, minWidth: 0, color: '#ffffff', backgroundColor: '#165954', borderRadius: 12, padding: '10px 12px', textAlign: 'right' }}>
        <div style={{ fontSize: 11 }}>{data.doctorTitle}</div>
        <div style={{ fontSize: 19, fontWeight: 800 }}>{data.doctorName}</div>
        {data.specialties.map((value, index) => <div key={index} style={{ fontSize: index ? 10 : 11 }}>{value}</div>)}
      </div>
    </div>
    <div style={{ border: `1px solid ${gold}`, borderRadius: 12, padding: '9px 12px', marginTop: 14, color: ink, backgroundColor: '#fffcf5', fontWeight: 700 }}>
      <div>الاسم: <span style={{ color: '#253748' }}>{data.patientName}</span></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 4 }}>
        <span style={{ minWidth: 0 }}>السن: <span style={{ color: '#253748' }}>{data.age} سنة</span></span>
        <span style={{ minWidth: 0 }}>التاريخ: <bdi style={{ color: '#253748' }}>{data.date}</bdi></span>
      </div>
    </div>
    <div style={{ position: 'relative', flex: 1, minHeight: 330, margin: '12px 0' }}>
      <div style={{ position: 'absolute', top: 100, left: 0, width: '100%', textAlign: 'center', opacity: 0.06, pointerEvents: 'none' }}>
        {tooth(true)}<div dir="ltr" style={{ color: ink, fontFamily: 'Georgia, serif', fontWeight: 700 }}>{data.doctorEnglish} Dental Clinic</div>
      </div>
      <div style={{ position: 'relative' }}>
        <div dir="ltr" style={{ color: ink, fontFamily: 'Georgia, serif', fontSize: 36, fontWeight: 800, paddingLeft: 6 }}>℞</div>
        {data.items.length ? data.items.map((item, index) => <div key={item.id} style={{ padding: '10px 8px', borderBottom: '1px solid #e2e8f0', breakInside: 'avoid' }}>
          <div dir="auto" style={{ fontSize: 15, fontWeight: 800, ...text }}><span style={{ color: ink }}>{index + 1}. </span>{item.drugName}</div>
          <div style={{ marginTop: 4, fontSize: 13, ...text }}><span dir="auto">{item.dosage}</span>{item.duration && <span> ({item.duration})</span>}</div>
        </div>) : <p style={{ color: '#64748b', textAlign: 'center', padding: '32px 0' }}>لم يتم إضافة أية أدوية بعد. اختر من الفهرس أو أضف دواء مخصص.</p>}
        {data.diagnosis && <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 10, border: '1px solid #c7d2fe', backgroundColor: '#eef2ff', ...text }}><strong>التشخيص: </strong>{data.diagnosis}</div>}
        {data.notes && <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 10, border: '1px solid #fde68a', backgroundColor: '#fffbeb', ...text }}><strong>إرشادات الطبيب: </strong>{data.notes}</div>}
      </div>
    </div>
    <div style={{ marginTop: 12, breakInside: 'avoid' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: ink, marginBottom: 8 }}><strong style={{ minWidth: 0, ...text }}>{data.clinicName}</strong><span style={{ minWidth: 0, color: '#64748b', fontSize: 11, ...text }}>ملف #{data.fileNo}</span></div>
      <div style={{ backgroundColor: ink, color: '#ffffff', padding: '10px 12px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 14 }}>
        <strong dir="ltr" style={{ fontSize: 14, minWidth: 0, flex: '0 1 40%', ...text }}>{data.phone}</strong>
        <span style={{ fontSize: 11, minWidth: 0, flex: 1, ...text }}>{data.address}</span>
      </div>
    </div>
  </div>;
}
