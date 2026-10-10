import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClinicContact, Patient } from '../types';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const built = buildSync({ stdin: { resolveDir: root, loader: 'tsx', contents: `
  import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
  import {DataTransferManagement} from './src/components/settings/DataTransferManagement';
  import {ToastAndConfirmProvider} from './src/components/common/ToastAndConfirm';
  import {DailyReportModal} from './src/components/reports/DailyReportModal';
  export const component = DataTransferManagement;
  export const render = props => renderToStaticMarkup(<ToastAndConfirmProvider><DataTransferManagement {...props}/></ToastAndConfirmProvider>);
  export const report = props => renderToStaticMarkup(<DailyReportModal {...props}/>);
` }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent' });
const compiled = { exports: {} as Record<'component', (props: any) => any> & Record<'render' | 'report', (props: any) => string> };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);

type Element = { type: any; props: Record<string, any> };
const nodes = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node];
const all = (node: any): Element[] => nodes(node).flatMap(item => item && typeof item === 'object' && item.props ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => nodes(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : item?.props ? text(item.props.children) : '').join('');
const patient = (id: string, name: string, mobile: string): Patient => ({ id, name, mobile, age: 30, firstVisit: '2026-10-10', notes: 'SYNTHETIC_PRIVATE_CLINICAL_NOTES', allergy: 'SYNTHETIC_PRIVATE_ALLERGY', sessions: [], payments: [] });
const patients = [patient('401', 'اسم أساسي', '01012345678'), patient('402', 'اسم أسرة ثانوي', '+201012345678'), patient('403', 'رقم من ملف فقط', '01112345678')];
const contacts: ClinicContact[] = [{ id: 'standalone', name: 'اسم مستقل', mobile: '01212345678', notes: 'ملاحظة تواصل', createdAt: '2026-10-10T10:00:00.000Z' }];
const props = (changes: Record<string, unknown> = {}) => ({ patients, contacts, canTransferData: true, canViewPatients: true,
  canImportPatients: true, canManageContacts: true, canExportPatientFinance: false, canExportFinancialReports: false,
  onImportPatients: async () => {}, onAuthorizePatientImport() {}, onImportContacts: async () => {}, onAuthorizeContactExport() {},
  onAuthorizeDataExport() {}, onExportFinancialReport() {}, onGetFullBackupSnapshot: async () => ({}), onRestoreFullData: async () => {}, ...changes });

function harness(changes: Record<string, unknown> = {}) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const slots: any[] = []; let tree: Element;
  const input = props(changes);
  const render = () => {
    let cursor = 0;
    const dispatcher = {
      useState(initial: any) { const i = cursor++; slots[i] ||= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, (next: any) => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
      useId() { return `synthetic-unified-export-${cursor++}`; },
      useRef(initial: any) { const i = cursor++; return slots[i] ||= { current: initial }; },
      useMemo(factory: () => any, deps: any[]) { const i = cursor++; if (!slots[i] || deps.some((value, j) => !Object.is(value, slots[i].deps[j]))) slots[i] = { value: factory(), deps }; return slots[i].value; },
      useEffect() { cursor++; }, useContext() { return { showToast() {}, askConfirm() {} }; },
    };
    const prior = internals.H; internals.H = dispatcher;
    try { tree = compiled.exports.component(input); } finally { internals.H = prior; }
  };
  const find = (predicate: (item: Element) => boolean) => { const found = all(tree).find(predicate); assert.ok(found, 'Missing export control'); return found; };
  const click = (label: string) => { find(item => item.type === 'button' && text(item).trim() === label).props.onClick(); render(); };
  render();
  return { click, find, get content() { return text(tree); },
    change(predicate: (item: Element) => boolean, value: string) { find(predicate).props.onChange({ target: { value } }); render(); },
    dialog() { return find(item => typeof item.type === 'function' && Array.isArray(item.props.allRows)).props; },
  };
}

test('real export panel includes patient-only phones and retains every family file, without clinical or financial metadata', () => {
  const h = harness(); h.click('جهات الاتصال');
  assert.match(h.content, /3 رقم تواصل متاح للتصدير/);
  h.click('تصدير جهات الاتصال');
  const output = h.dialog().allRows;
  assert.equal(output.length, 3);
  assert.deepEqual(output.find((row: any) => row.mobile === '01012345678').patientIds, ['401', '402']);
  assert.deepEqual(output.find((row: any) => row.mobile === '01112345678').patientIds, ['403']);
  assert.equal(output.find((row: any) => row.mobile === '01212345678').notes, 'ملاحظة تواصل');
  assert.doesNotMatch(JSON.stringify(output), /SYNTHETIC_PRIVATE|sessions|payments|amount|allergy/);
});

test('export stays available with zero standalone contacts and searches secondary family names', () => {
  const h = harness({ contacts: [] }); h.click('جهات الاتصال');
  assert.match(h.content, /2 رقم تواصل متاح للتصدير/);
  h.change(item => item.type === 'input' && item.props.type === 'search', 'أسرة ثانوي');
  h.click('تصدير جهات الاتصال');
  assert.equal(h.dialog().allRows.length, 2);
  assert.equal(h.dialog().filteredRows.length, 1);
  assert.deepEqual(h.dialog().filteredRows[0].patientIds, ['401', '402']);
});

test('export file/no-file filters use the same complete directory as contacts and WhatsApp', () => {
  const h = harness(); h.click('جهات الاتصال');
  h.change(item => item.type === 'select', 'without-file'); h.click('تصدير جهات الاتصال');
  assert.deepEqual(h.dialog().filteredRows.map((row: any) => row.name), ['اسم مستقل']);
  h.change(item => item.type === 'select', 'with-file');
  assert.equal(h.dialog().filteredRows.length, 2);
  assert.ok(h.dialog().filteredRows.every((row: any) => row.patientIds.length));
});

test('secretary transfer denial renders no contact export or backup controls even with all other capabilities', () => {
  const html = compiled.exports.render(props({ canTransferData: false, canManageFullBackup: true, canExportPatientFinance: true, canExportFinancialReports: true }));
  assert.match(html, /غير متاحة لحساب السكرتارية/);
  assert.doesNotMatch(html, /<button|SYNTHETIC_PRIVATE|01012345678|01212345678/);
});

test('report identifies its balance as current file debt, never an attributed historical visit balance', () => {
  const html = compiled.exports.report({ isOpen: true, onClose() {}, patients: [], appointments: [] });
  assert.match(html, /رصيد الملفات الحالي|وليس رصيدًا تاريخيًا للفترة/);
  assert.doesNotMatch(html, /ديون زيارات|متبقي غير مسدد على جلسات الفترة/);
});
