import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import type { ClinicContact, Patient } from '../types';
import type { ClinicContactsProps } from '../components/settings/ClinicContacts';

// Exercise real React markup without a browser, storage writes or downloaded files.
// CSS is handled by the browser QA separately; this loader omits it only for SSR.
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundle = buildSync({
  stdin: {
    contents: `import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { ToastAndConfirmProvider } from './src/components/common/ToastAndConfirm';
      import { ClinicContacts } from './src/components/settings/ClinicContacts';
      import { ContactExportDialog, ContactImportDialog } from './src/components/settings/ContactTransferDialog';
      const render = (Component, props) => renderToStaticMarkup(React.createElement(ToastAndConfirmProvider, null, React.createElement(Component, props)));
      export const renderView = props => render(ClinicContacts, props);
      export const renderExport = props => render(ContactExportDialog, props);
      export const renderImport = props => render(ContactImportDialog, props);`,
    resolveDir: sourceRoot,
    sourcefile: 'clinicContactsView.fixture.tsx',
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  packages: 'external',
  loader: { '.css': 'empty' },
  logLevel: 'silent',
});
const compiled = { exports: {} as { renderView: (props: ClinicContactsProps) => string; renderExport: (props: unknown) => string; renderImport: (props: unknown) => string } };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { renderView, renderExport, renderImport } = compiled.exports;

const contact: ClinicContact = { id: 'fake-contact', name: 'جهة اتصال تجريبية', mobile: '01012345678', notes: '', createdAt: '2026-10-07T12:00:00.000Z' };
const patient = (id: string, mobile: string): Patient => ({ id, name: `مريض تجريبي ${id}`, mobile, age: 30, firstVisit: '2026-10-01', notes: 'PRIVATE_CLINICAL_NOTE', allergy: '', sessions: [], payments: [] });
const baseProps: ClinicContactsProps = { contacts: [contact], patients: [patient('401', '+201012345678'), patient('402', '٠١٠١٢٣٤٥٦٧٨')], onSave: () => {}, onDelete: () => {} };

test('read-only contact view hides mutation controls even when import callback exists', () => {
  const markup = renderView({ ...baseProps, onImportContacts: async () => ({ addedCount: 0, duplicateCount: 0, invalidCount: 0 }) });
  assert.doesNotMatch(markup, /إضافة جهة اتصال|تعديل جهة الاتصال|حذف جهة الاتصال|استيراد ملف/);
  assert.match(markup, /البحث بالاسم أو الموبايل/);
  assert.doesNotMatch(markup, /PRIVATE_CLINICAL_NOTE/);
});

test('every shared-phone file has an explicit badge alongside the contact name', () => {
  const markup = renderView(baseProps);
  const nameBlock = markup.match(/class="cc-contact-name"[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(nameBlock, /جهة اتصال تجريبية/);
  assert.match(nameBlock, /ملف #401/);
  assert.match(nameBlock, /ملف #402/);
  assert.match(markup, /تطابق رقم فقط/);
});

test('manager gets import/export actions without invoking authorization or data writes on render', () => {
  let authorizationCalls = 0;
  let imports = 0;
  const markup = renderView({ ...baseProps, canManageContacts: true, onAuthorizeExport: () => { authorizationCalls++; }, onImportContacts: async () => { imports++; return { addedCount: 0, duplicateCount: 0, invalidCount: 0 }; } });
  assert.match(markup, /إضافة جهة اتصال/);
  assert.match(markup, /تعديل جهة الاتصال/);
  assert.match(markup, /استيراد ملف/);
  assert.match(markup, />تصدير</);
  assert.equal(authorizationCalls, 0);
  assert.equal(imports, 0);
});

test('read-only export is available only with an explicit authorization callback', () => {
  assert.doesNotMatch(renderView(baseProps), />تصدير</);
  assert.match(renderView({ ...baseProps, onAuthorizeExport: () => {} }), />تصدير</);
  const emptyMarkup = renderView({ ...baseProps, contacts: [], patients: [] });
  assert.doesNotMatch(emptyMarkup, /إضافة أول جهة اتصال|إضافة جهة اتصال/);
});

test('export dialog describes all filtered results, not just one list page, and never downloads on render', () => {
  let authorizationCalls = 0;
  const row = { name: 'اسم تجريبي', mobile: '01012345678', notes: '', patientIds: ['401'] };
  const markup = renderExport({ allRows: Array(60).fill(row), filteredRows: Array(42).fill(row), filterActive: true, onAuthorizeExport: () => { authorizationCalls++; }, onClose: () => {} });
  assert.match(markup, /سيحتوي الملف على 42 جهة اتصال/);
  assert.match(markup, /كل النتائج، مش الصفحة الظاهرة فقط/);
  assert.match(markup, /Excel \(.xlsx\)/);
  assert.match(markup, /CSV \(.csv\)/);
  assert.match(markup, /بدون جلسات أو دفعات أو بيانات مالية/);
  assert.equal(authorizationCalls, 0);
});

test('import dialog starts with file guidance and a disabled confirmation, not implicit writes', () => {
  let imports = 0;
  const markup = renderImport({ contacts: [], patients: [], onImport: async () => { imports++; return { addedCount: 0, duplicateCount: 0, invalidCount: 0 }; }, onClose: () => {} });
  assert.match(markup, /أول ورقة فقط/);
  assert.match(markup, /احفظ عمود الموبايل كنص/);
  assert.match(markup, /مش هنفتح ملفات مرضى أو نسجّل موافقة على الحملات/);
  assert.match(markup, /accept=".xlsx,.xls,.csv"/);
  assert.match(markup, /disabled=""[^>]*>[\s\S]*?استيراد 0 جهة اتصال/);
  assert.equal(imports, 0);
});
