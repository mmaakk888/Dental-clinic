import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Render the real components without a browser, storage writes, or patient data.
// CSS is ignored only in this SSR test; this does not certify visual layout.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const result = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { HomeView } from './src/components/home/HomeView';
    import { HomePaymentModal } from './src/components/home/HomePaymentModal';
    import { QuickWalkInModal } from './src/components/walkin/QuickWalkInModal';
    import { SmartScheduleModal } from './src/components/appointments/SmartScheduleModal';
    import { DailyReportModal } from './src/components/reports/DailyReportModal';
    import { InvoiceOcrModal } from './src/components/summary/InvoiceOcrModal';
    import { ToastAndConfirmProvider } from './src/components/common/ToastAndConfirm';
    import { getDefaultPermissionsForRole } from './src/utils/rbac';
    import { localDateISO } from './src/components/appointments/appointmentScheduling';
    const noop = () => {};
    const fakePatients = Array.from({length: 5000}, (_, i) => ({id: String(i + 1), name: 'اختبارمريض' + (i + 1), mobile: '', age: 0, firstVisit: '', notes: '', allergy: '', sessions: [{id: 's' + i, type: 'خدمة تجريبية', date: localDateISO(), amount: 10, paid: 0, services: []}], payments: []}));
    export function renderCase(kind, restricted = false) {
      const user = {id:'qa',role:'secretary',isActive:true,permissions:{...getDefaultPermissionsForRole('secretary'),summary:!restricted,viewExpenses:!restricted,patientView:!restricted}};
      let content;
      if(kind === 'home') content = <HomeView clinicName='عيادة اختبار' labels={{}} tileOrder={[]} patientCount={0} todayApptCount={0} activeLabCount={0} currentUser={user} onNavigate={noop} patients={fakePatients} onOpenWalkIn={noop} onOpenScheduleModal={noop} onOpenPayment={noop} onOpenInvoiceModal={noop} onOpenDailyReport={noop} />;
      if(kind === 'walkin') content = <QuickWalkInModal isOpen patients={fakePatients} onClose={noop} onSaveWalkInVisit={noop} />;
      if(kind === 'payment') content = <HomePaymentModal patients={fakePatients} showRemaining={false} onClose={noop} onSave={noop} onOpenPatient={noop} />;
      if(kind === 'schedule') content = <SmartScheduleModal isOpen patients={fakePatients} existingAppointments={[]} onClose={noop} onBookAppointment={noop} />;
      if(kind === 'report') content = <DailyReportModal isOpen patients={fakePatients} appointments={[]} onClose={noop} canViewHistory={false} />;
      if(kind === 'invoice') content = <InvoiceOcrModal isOpen onClose={noop} onSaveExpense={noop} />;
      return renderToStaticMarkup(<ToastAndConfirmProvider>{content}</ToastAndConfirmProvider>);
    }
  ` },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, loader: { '.css': 'empty' },
});
const module = { exports: {} as { renderCase: (kind: string, restricted?: boolean) => string } };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { renderCase } = module.exports;

test('actual home quick actions render all five outcomes and hide actions without patient/expense access', () => {
  const home = renderCase('home');
  for (const title of ['زيارة بدون موعد', 'حجز موعد', 'تسجيل دفعة', 'إضافة فاتورة مصروف', 'التقرير اليومي']) assert.ok(home.includes(title), title);
  const restricted = renderCase('home', true);
  for (const title of ['زيارة بدون موعد', 'حجز موعد', 'تسجيل دفعة', 'إضافة فاتورة مصروف', 'التقرير اليومي']) assert.ok(!restricted.includes(title), title);
});

test('all five real quick-action dialogs have matching accessible titles and the shared responsive shell', () => {
  for (const kind of ['walkin', 'payment', 'schedule', 'report', 'invoice']) {
    const html = renderCase(kind);
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /clinic-action-header/);
    assert.match(html, /clinic-action-footer/);
    const titleId = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    assert.ok(titleId && html.includes('id="' + titleId + '"'), kind);
  }
});

test('real action dialogs keep initial patient result rendering bounded for 5000 fake files', () => {
  assert.equal((renderCase('walkin').match(/اختبارمريض/g) || []).length, 4);
  assert.equal((renderCase('payment').match(/اختبارمريض/g) || []).length, 20);
  assert.equal((renderCase('schedule').match(/اختبارمريض/g) || []).length, 8);
  assert.equal((renderCase('report').match(/اختبارمريض/g) || []).length, 50);
});

test('walk-in has no automatic extraction, pre-filled receipt or unsupported card/transfer choice', () => {
  const html = renderCase('walkin');
  assert.ok(!html.includes('اسم الخدمة 1'));
  assert.ok(html.includes('تُحفظ الزيارة والكشف والدفعة مرة واحدة'));
  assert.ok(!html.includes('Card'));
  assert.ok(!html.includes('تحويل إلكتروني'));
  assert.ok(!html.includes('تم التسديد بالكامل'));
});
