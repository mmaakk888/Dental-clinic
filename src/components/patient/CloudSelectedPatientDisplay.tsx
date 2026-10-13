import React, { useSyncExternalStore } from 'react';
import type { CloudClinicalWorkspaceController } from '../../utils/cloudClinicalWorkspaceController';
import type { CloudClinicalPatientSnapshot } from '../../utils/cloudClinicalPatientProjection';

/** Only the selected, fenced public patient projection. No clinic aggregate,
 * laboratory costs, contact directory or data adapter is available here. */
export function CloudSelectedPatientDisplayView({ snapshot }: { snapshot: CloudClinicalPatientSnapshot | null }) {
  if (!snapshot) return <div><h1>عرض المريض</h1><p>افتح ملف المريض أولًا؛ بقية تفاصيل العيادة مخفية.</p></div>;
  const amount = (cents: number) => (cents / 100).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <article aria-label="حساب المريض المختار فقط">
    <h1>{snapshot.profile.data.name}</h1><p>رقم الملف <bdi>{snapshot.profile.fileNo}</bdi></p>
    <div className="cloud-overview__metrics">
      {([['إجمالي الخدمات', snapshot.totalCents], ['المدفوع', snapshot.paidCents], ['المتبقي', snapshot.totalCents - snapshot.paidCents]] as const)
        .map(([label, cents]) => <section className="cloud-overview__metric" key={label}><span>{label}</span><strong>{amount(cents)} ج.م</strong></section>)}
    </div>
    <h2>الجلسات</h2><ul className="cloud-overview__rows">{snapshot.patient.sessions.map(session => <li key={session.id}>
      <div><strong>{session.type}</strong><small>{session.services?.map(service => service.name).join('، ')}</small></div>
      <time dateTime={session.date}><bdi>{session.date}</bdi></time>
    </li>)}</ul>
  </article>;
}
export function CloudSelectedPatientDisplay({ controller }: { controller: CloudClinicalWorkspaceController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  return <CloudSelectedPatientDisplayView snapshot={state.closed || state.loading ? null : state.snapshot} />;
}
