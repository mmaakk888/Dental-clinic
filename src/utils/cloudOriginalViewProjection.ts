import type { Appointment, Lab, LabCase } from '../types';
import type { CloudClinicSnapshot } from './cloudClinicSnapshot';

/** Presentation only. Input is the COMPLETE reconciled clinic snapshot, never
 * a directory page or a client-written aggregate. Cash remains receipts only. */
export function projectOriginalClinicViews(snapshot: CloudClinicSnapshot) {
  const patients = new Map(snapshot.patients.map(row => [row.patientRecordId, row]));
  const sessions = new Map(snapshot.records.patientSessions.map(row => [row.sessionId, row]));
  const appointments: Appointment[] = snapshot.records.appointmentRecords.map(row => {
    const patient = row.data.patientRecordId ? patients.get(row.data.patientRecordId) : null;
    return { id: row.recordId, patientId: patient ? String(patient.profile.fileNo) : '', fileNo: patient ? String(patient.profile.fileNo) : '',
      patientName: row.data.patientName, mobile: row.data.phone, date: row.data.date, time: row.data.time,
      note: row.data.notes || row.data.reason, doctorName: row.data.doctorName, durationMinutes: row.data.durationMinutes,
      appointmentType: row.data.appointmentType, isFollowUp: row.data.isFollowUp, isWalkIn: row.data.isWalkIn, status: row.data.status };
  });
  const labs: Lab[] = snapshot.records.labDefinitions.filter(row => row.data.active).map(row => ({ id: row.recordId, name: row.data.name,
    phone: row.data.phone, address: row.data.address, notes: row.data.notes,
    services: row.data.costs.filter(cost => cost.active && cost.unitCostCents !== null).map(cost => ({ id: cost.materialId, category: cost.category,
      name: cost.name, unitLabel: cost.unitLabel, price: cost.unitCostCents! / 100 })) }));
  const labCases: LabCase[] = snapshot.records.labCases.map(row => {
    const patient = patients.get(row.patientId), session = sessions.get(row.sessionId);
    if (!patient || !session) throw new Error('تعذر تأكيد حساب التركيبة بالكامل.');
    return { id: row.recordId, linkedSessionId: row.sessionId, labServiceId: row.snapshot.materialId, teethIds: [...row.snapshot.teethIds],
      labId: row.labId, labName: row.snapshot.labName, patientId: String(row.fileNo), patientName: patient.profile.data.name, fileNo: String(row.fileNo),
      type: row.snapshot.kind === 'fixed' ? 'تركيبة ثابتة' : 'تركيبة متحركة', subType: row.snapshot.serviceName,
      units: row.snapshot.units, unitLabel: row.snapshot.unitLabel, labTotal: row.totalCostCents / 100, labPaid: row.paidCostCents / 100,
      patientTotal: session.totalCents / 100, patientPaid: session.paidCents / 100, date: row.snapshot.date,
      ...(row.snapshot.deliveryExpectedDate ? { deliveryExpectedDate: row.snapshot.deliveryExpectedDate } : {}), note: row.note,
      status: row.status === 'in_progress' ? 'pending' : row.status,
      paymentsLog: snapshot.records.labPayments.flatMap(payment => payment.allocations.filter(item => item.caseId === row.recordId)
        .map(item => ({ id: payment.receiptId, date: payment.date, amount: item.amountCents / 100, note: payment.note, paymentMethod: 'cash' as const }))) };
  });
  const crownPrices: Record<string, number> = {};
  for (const row of snapshot.settings.serviceCatalog.data.services) {
    if (!row.active || row.kind !== 'prosthetic' || row.priceCents === null) continue;
    if (Object.hasOwn(crownPrices, row.name)) throw new Error('توجد أسماء تركيبات متكررة؛ راجع فهرس الأسعار.');
    crownPrices[row.name] = row.priceCents / 100;
  }
  return { appointments, labs, labCases, crownPrices };
}
