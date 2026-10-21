import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { downloadAuthorizedImage, printAuthorizedDocument, requireAuthorizedDataOutput } from './authorizedDataOutput';
import { ExpenseDetailModal } from '../components/summary/ExpenseDetailModal';
import { ToastAndConfirmProvider } from '../components/common/ToastAndConfirm';
import type { Expense, Patient } from '../types';

const rxBuild = buildSync({ stdin: { resolveDir: fileURLToPath(new URL('../..', import.meta.url)), loader: 'tsx', contents: `
  import React from 'react';
  import {renderToStaticMarkup} from 'react-dom/server';
  import {PrescriptionAndInstructionsView} from './src/components/patient/PrescriptionAndInstructionsView';
  import {ToastAndConfirmProvider} from './src/components/common/ToastAndConfirm';
  export const renderPrescription = props => renderToStaticMarkup(<ToastAndConfirmProvider><PrescriptionAndInstructionsView {...props}/></ToastAndConfirmProvider>);
` }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent' });
const rxModule = { exports: {} as { renderPrescription: (props: unknown) => string } };
new Function('require', 'module', 'exports', rxBuild.outputFiles[0].text)(createRequire(import.meta.url), rxModule, rxModule.exports);

test('in-app data output fails closed without capability and a fresh authorization callback', () => {
  let checks = 0, prints = 0;
  const authorize = () => { checks++; };
  for (const allowed of [false, true]) {
    assert.throws(() => requireAuthorizedDataOutput(allowed));
    assert.throws(() => printAuthorizedDocument(allowed, undefined, () => { prints++; }));
  }
  assert.throws(() => printAuthorizedDocument(false, authorize, () => { prints++; }));
  assert.equal(checks, 0);
  assert.equal(prints, 0);
  printAuthorizedDocument(true, authorize, () => { prints++; });
  assert.equal(checks, 1);
  assert.equal(prints, 1);
});

test('a stale print capability never bypasses revoked session authorization', () => {
  let prints = 0;
  assert.throws(() => printAuthorizedDocument(true, () => { throw new Error('synthetic revoked session'); }, () => { prints++; }));
  assert.equal(prints, 0);
});

test('image output authorizes before touching the DOM and immediately before click, with cleanup on revocation', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const calls: string[] = [];
  const anchor = { href: '', download: '', click: () => calls.push('click'), remove: () => calls.push('remove') };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => { calls.push('create'); return anchor; }, body: { appendChild: () => calls.push('append') },
  } });
  try {
    assert.throws(() => downloadAuthorizedImage('data:image/png;base64,fake', 'fake.png', false, () => calls.push('authorize')));
    assert.deepEqual(calls, []);
    downloadAuthorizedImage('data:image/png;base64,fake', 'fake.png', true, () => calls.push('authorize'));
    assert.deepEqual(calls, ['authorize', 'create', 'append', 'authorize', 'click', 'remove']);
    assert.equal(anchor.download, 'fake.png');
    calls.length = 0;
    let checks = 0;
    assert.throws(() => downloadAuthorizedImage('data:image/png;base64,fake', 'fake.png', true, () => {
      calls.push('authorize'); if (++checks === 2) throw new Error('synthetic role changed');
    }));
    assert.deepEqual(calls, ['authorize', 'create', 'append', 'authorize', 'remove']);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

const expense: Expense = { id: 'synthetic-output-expense', title: 'فاتورة اختبار مصطنعة', category: 'supplies', amount: 50, date: '2026-10-10', invoiceImageUrl: 'data:image/png;base64,fake' };
const renderExpense = (canExportData?: boolean, authorize?: () => void, isPrivacyMode = false) => renderToStaticMarkup(React.createElement(ToastAndConfirmProvider, null,
  React.createElement(ExpenseDetailModal, { expense, isOpen: true, onClose: () => {}, canExportData, onAuthorizeDataExport: authorize, isPrivacyMode })));

test('invoice download controls are absent by default, for denied roles, absent authorizer and privacy mode', () => {
  for (const html of [renderExpense(), renderExpense(false, () => {}), renderExpense(true), renderExpense(true, () => {}, true)]) {
    assert.ok(!html.includes('title="تنزيل الصورة"'));
    assert.ok(!html.includes('download='));
    assert.ok(html.includes('صورة الفاتورة الأصلية'));
  }
  assert.ok(renderExpense(true, () => {}).includes('title="تنزيل الصورة"'));
});

test('prescription print controls require both opt-in capability and fresh authorization', () => {
  const patient: Patient = { id: 'synthetic-output-patient', name: 'اسم اختبار مصطنع', mobile: '01000000000', age: 30, gender: 'male', firstVisit: '2026-10-10', notes: '', allergy: '', sessions: [], payments: [] };
  const render = (canPrint?: boolean, onAuthorizePrint?: () => void) => rxModule.exports.renderPrescription({ patient, clinicName: 'عيادة اختبار', clinicLogo: null, drugCatalog: [], canSendWhatsApp: false, canPrint, onAuthorizePrint });
  for (const html of [render(), render(false, () => {}), render(true)]) assert.ok(!html.includes('طباعة الروشتة (A5)'));
  assert.ok(render(true, () => {}).includes('طباعة الروشتة (A5)'));
});

test('standalone image and print consumers have no unguarded download anchors or print fallback', () => {
  const summary = readFileSync(new URL('../components/summary/SummaryView.tsx', import.meta.url), 'utf8');
  const expenseSource = readFileSync(new URL('../components/summary/ExpenseDetailModal.tsx', import.meta.url), 'utf8');
  const shortcuts = readFileSync(new URL('../hooks/useKeyboardShortcuts.ts', import.meta.url), 'utf8');
  const prescription = readFileSync(new URL('../components/patient/PrescriptionAndInstructionsView.tsx', import.meta.url), 'utf8');
  assert.ok(!/\bdownload=/.test(summary));
  assert.ok(summary.includes('downloadAuthorizedImage('));
  assert.ok(expenseSource.includes('downloadAuthorizedImage('));
  assert.ok(!/window\.print\(/.test(shortcuts));
  assert.ok(!/window\.print\(/.test(prescription));
  assert.ok(shortcuts.includes('options.canPrint === true, options.onAuthorizePrint'));
});
