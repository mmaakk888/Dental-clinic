import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppointmentDraftGuard } from './appointmentDraftGuard';

test('conflict approval is invalid after any edit, even if the original draft is restored', () => {
  const guard = createAppointmentDraftGuard();
  guard.update(true, 'patient-401/17:30');
  const approve = guard.capture();
  assert.equal(approve(), true);
  guard.update(true, 'patient-402/17:30');
  assert.equal(approve(), false);
  guard.update(true, 'patient-401/17:30');
  assert.equal(approve(), false);
  assert.equal(guard.capture()(), true);
});

test('closing, reopening, or unmounting cannot revive a pending conflict approval', () => {
  const guard = createAppointmentDraftGuard();
  guard.update(true, 'draft');
  const approve = guard.capture();
  guard.update(false, 'draft');
  assert.equal(approve(), false);
  guard.update(true, 'draft');
  assert.equal(approve(), false);
  const reopenedApproval = guard.capture();
  guard.update(false, '');
  assert.equal(reopenedApproval(), false);
});

test('a refreshed conflict or patient snapshot requires new approval; identical rerenders do not', () => {
  const guard = createAppointmentDraftGuard();
  const context = JSON.stringify({ patient: '401', time: '17:30', appointments: ['existing-1'] });
  guard.update(true, context);
  const approve = guard.capture();
  guard.update(true, context);
  assert.equal(approve(), true);
  guard.update(true, JSON.stringify({ patient: '401', time: '17:30', appointments: ['existing-1', 'existing-2'] }));
  assert.equal(approve(), false);
});

test('an explicit close request immediately revokes approval before the next render', () => {
  const guard = createAppointmentDraftGuard();
  guard.update(true, 'draft');
  const approve = guard.capture();
  guard.invalidate();
  assert.equal(approve(), false);
});
