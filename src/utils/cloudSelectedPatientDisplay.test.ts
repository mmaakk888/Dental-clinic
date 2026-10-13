import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { CloudSelectedPatientDisplayView } from '../components/patient/CloudSelectedPatientDisplay';
import { createCloudClinicSnapshotReader } from './cloudClinicSnapshot';
import { makeClinicSnapshotFixture, snapshotDigest } from './testing/cloudClinicSnapshotFixtures';

test('patient display shows only the selected fenced file/account and no clinic/lab/private directory', async () => {
  const fixture = await makeClinicSnapshotFixture(), snapshot = await createCloudClinicSnapshotReader(fixture.adapter, { digest: snapshotDigest }).readFull();
  const selected = snapshot.patients[0];
  const html = renderToStaticMarkup(React.createElement(CloudSelectedPatientDisplayView, { snapshot: selected }));
  assert.match(html, /حساب المريض المختار فقط/); assert.match(html, /رقم الملف/);
  assert.match(html, /المدفوع/); assert.match(html, /المتبقي/);
  assert.doesNotMatch(html, /totalCostCents|labAccounts|recordedBy|synthetic-whole-clinic-owner|محجوز للمعامل|صافي الحركة/);
  assert.equal(html.includes(selected.patientRecordId), false);
});
test('no selected patient never shows a previous snapshot or clinic aggregate', () => {
  const html = renderToStaticMarkup(React.createElement(CloudSelectedPatientDisplayView, { snapshot: null }));
  assert.match(html, /افتح ملف المريض أولًا/); assert.doesNotMatch(html, /المدفوع|إجمالي الخدمات/);
});
test('patient-only view graph has no SDK, cloud capabilities, local data or whole-clinic query', async () => {
  const result = await build({ entryPoints: ['src/components/patient/CloudSelectedPatientDisplay.tsx'], bundle: true, write: false,
    platform: 'browser', packages: 'external', metafile: true, logLevel: 'silent' });
  assert.equal(Object.keys(result.metafile!.inputs).some(path => /firebase|storage\.ts|App\.tsx|cloudClinicSnapshot\.ts|Repository\.ts/.test(path)), false);
});
