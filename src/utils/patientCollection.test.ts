import test from 'node:test';
import assert from 'node:assert/strict';
import type { Patient, Session } from '../types';
import { getPatientCollectionPresentation, getPatientSessionReceiptLimit } from './patientCollection';

const session: Session = { id: 'fake-session', type: 'خدمة اختبار', tooth: null, amount: 100, discount: 10, paid: 20, remain: 70,
  date: '2026-10-07', paymentsLog: [{ id: 'fake-receipt', amount: 20, date: '2026-10-07' }] };
const patient: Patient = { id: 'fake-patient', name: 'مريض اختبار', mobile: '', age: 30, firstVisit: '2026-10-07', notes: '', allergy: '',
  sessions: [session], payments: [{ id: 'fake-general-receipt', amount: 40, date: '2026-10-07', createdAt: '2026-10-07T10:00:00Z' }] };

test('collection limits account for discounts, current session receipts, and independent general receipts', () => {
  assert.equal(getPatientSessionReceiptLimit(patient, session), 30);
  assert.deepEqual(getPatientCollectionPresentation(patient, session, true), {
    initialAmount: 30, maxAmount: 30, optionSuffix: ' — المتاح للتحصيل: 30 ج.م',
  });
});

test('privacy or missing balance permission leaves no numeric balance in defaults, input maximum, or option labels', () => {
  for (const isPrivacyMode of [false, true]) {
    for (const canViewRemaining of [false, true]) {
      if (!isPrivacyMode && canViewRemaining) continue;
      assert.deepEqual(getPatientCollectionPresentation(patient, session, canViewRemaining && !isPrivacyMode), {
        initialAmount: '', maxAmount: undefined, optionSuffix: '',
      });
    }
  }
});

test('absence of a selected service never falls back to a patient balance as a visible amount', () => {
  assert.deepEqual(getPatientCollectionPresentation(patient, undefined, true), { initialAmount: '', maxAmount: undefined, optionSuffix: '' });
});

test('fully settled patient cannot produce a positive default from an independently unsettled session', () => {
  const settled = { ...patient, payments: [{ ...patient.payments[0], amount: 70 }] };
  assert.equal(getPatientSessionReceiptLimit(settled, session), 0);
  assert.equal(getPatientCollectionPresentation(settled, session, true).initialAmount, 0);
});
