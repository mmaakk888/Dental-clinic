import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Patient, ClinicContact } from '../types';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const built = buildSync({ stdin: { resolveDir: root, loader: 'tsx', contents: `
  import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
  import {ClinicContacts} from './src/components/settings/ClinicContacts';
  import {PatientsView} from './src/components/patients/PatientsView';
  import {WhatsAppManagement} from './src/components/settings/WhatsAppManagement';
  import {WhatsAppCampaigns} from './src/components/settings/WhatsAppCampaigns';
  import {ToastAndConfirmProvider} from './src/components/common/ToastAndConfirm';
  export const directory = ClinicContacts; export const patients = PatientsView.type;
  export const management = WhatsAppManagement; export const campaigns = WhatsAppCampaigns;
  export const render = props => renderToStaticMarkup(<ToastAndConfirmProvider><ClinicContacts {...props}/></ToastAndConfirmProvider>);
  export const renderManagement = props => renderToStaticMarkup(<ToastAndConfirmProvider><WhatsAppManagement {...props}/></ToastAndConfirmProvider>);
` }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent' });
const compiled = { exports: {} as Record<'directory' | 'patients' | 'management' | 'campaigns', (props: any) => any> & Record<'render' | 'renderManagement', (props: any) => string> };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);

type Element = { type: unknown; props: Record<string, any> };
const children = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(children) : [node];
const all = (node: any): Element[] => children(node).flatMap(item => item && typeof item === 'object' && item.props ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : item?.props ? text(item.props.children) : '').join('');
const patient = (id: string, name: string, mobile: string): Patient => ({ id, name, mobile, age: 30, firstVisit: '2026-10-10', notes: 'SYNTHETIC_CLINICAL_PRIVATE', allergy: '', sessions: [], payments: [] });
const patients = [patient('401', 'أحمد علي محمود', '01012345678'), patient('409', 'سارة حسن', '01112345678')];
const contacts: ClinicContact[] = [{ id: 'c1', name: 'محمد علي محمود', mobile: '01212345678', createdAt: '2026-10-10T10:00:00.000Z' }];
const directoryProps = { contacts, patients, onSave() {}, onDelete() {}, canManageContacts: true };

function harness(component: (props: any) => any, props: Record<string, any>) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const slots: any[] = [], toasts: string[] = [], confirmations: any[] = []; let tree: Element;
  const context = { showToast: (message: string) => toasts.push(message), askConfirm: (request: any) => confirmations.push(request), validationFail: (_modal: string, _field: string, message: string) => toasts.push(message) };
  const render = () => {
    let cursor = 0;
    const dispatcher = {
      useState(initial: any) { const index = cursor++; slots[index] ||= { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, (next: any) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
      useId() { return `synthetic-directory-${cursor++}`; },
      useRef(initial: any) { const index = cursor++; return slots[index] ||= { current: initial }; },
      useMemo(factory: () => any, deps: any[]) { const index = cursor++; if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) slots[index] = { value: factory(), deps }; return slots[index].value; },
      useDeferredValue(value: any) { cursor++; return value; }, useEffect() { cursor++; }, useContext() { return context; },
      useCallback(callback: any) { cursor++; return callback; },
    };
    const prior = internals.H; internals.H = dispatcher;
    try { tree = component(props); } finally { internals.H = prior; }
    return tree;
  };
  const find = (predicate: (item: Element) => boolean) => { const item = all(tree).find(predicate); assert.ok(item, 'Missing synthetic directory control'); return item; };
  render();
  return { render, find, toasts, confirmations, get elements() { return all(tree); }, get content() { return text(tree); },
    clickLabel(label: string) { find(item => item.type === 'button' && text(item).trim() === label).props.onClick(); render(); },
    change(predicate: (item: Element) => boolean, value: string) { find(predicate).props.onChange({ target: { value } }); render(); },
    async submit() { await find(item => item.type === 'form').props.onSubmit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve)); render(); },
  };
}

test('SSR directory includes phones from patient files even with no standalone contacts; derived rows have no contact-delete/editor controls', () => {
  const html = compiled.exports.render({ ...directoryProps, contacts: [] });
  assert.match(html, /أحمد علي محمود|سارة حسن|ملف #401|ملف #409|من ملفات المرضى/);
  assert.equal((html.match(/data-contact-source="patient"/g) || []).length, 2);
  assert.doesNotMatch(html, /تعديل جهة الاتصال|حذف جهة الاتصال|SYNTHETIC_CLINICAL_PRIVATE|استيراد ملف|>تصدير</);
  const mixed = compiled.exports.render(directoryProps);
  assert.equal((mixed.match(/data-contact-source="contact"/g) || []).length, 1);
  assert.equal((mixed.match(/data-contact-source="patient"/g) || []).length, 2);
  assert.match(mixed, /تعديل جهة الاتصال محمد علي محمود/);
});

test('actual directory search finds secondary family names and exact file link uses source ID without writes', () => {
  let writes = 0; const opened: string[] = [];
  const family = [...patients, patient('402', 'اسم أسرة مختلف', '+201012345678')];
  const h = harness(compiled.exports.directory, { ...directoryProps, patients: family, onSave: () => { writes++; }, onDelete: () => { writes++; }, onOpenPatient: (id: string) => opened.push(id) });
  h.change(item => item.type === 'input' && item.props.type === 'search', 'أسرة مختلف');
  const cards = h.elements.filter(item => item.type === 'article'); assert.equal(cards.length, 1);
  const fileGroup = all(cards[0]).find(item => typeof item.type === 'function' && item.props.onOpenPatient && item.props.matches);
  assert.ok(fileGroup); assert.deepEqual(fileGroup.props.matches.map((file: any) => file.id), ['401', '402']);
  // This helper has no hooks. Invoke its actual rendering to reach the real
  // file-link callback instead of inventing a parallel test implementation.
  const fileButtons = all((fileGroup.type as (props: any) => any)(fileGroup.props));
  fileButtons.find(item => item.type === 'button' && text(item).includes('ملف #402'))!.props.onClick();
  assert.deepEqual(opened, ['402']); assert.equal(writes, 0);
  h.change(item => item.type === 'input' && item.props.type === 'search', '٠١١١٢٣٤٥٦٧٨');
  assert.equal(h.elements.filter(item => item.type === 'article').length, 1);
  assert.ok(h.elements.some(item => item.props.name === 'سارة حسن'));
});

test('derived patient directory remains paginated instead of mounting every phone card', () => {
  const many = Array.from({ length: 200 }, (_, i) => patient(String(i + 1), `اختبار رقم ${i + 1}`, `010${String(i).padStart(8, '0')}`));
  const h = harness(compiled.exports.directory, { ...directoryProps, patients: many, contacts: [] });
  assert.equal(h.elements.filter(item => item.type === 'article').length, 25);
  assert.match(h.content, /200 رقم تواصل/); h.clickLabel('التالي');
  assert.equal(h.elements.filter(item => item.type === 'article').length, 25);
});

test('contact sections visibly split file/no-file phone counts, retain family files and filter without data mutations', () => {
  let writes = 0;
  const family = [...patients, patient('402', 'اسم أسرة مختلف', '+201012345678')];
  const alias = { ...contacts[0], id: 'alias', name: 'رقم أسرة محفوظ', mobile: '01012345678' };
  const h = harness(compiled.exports.directory, { ...directoryProps, contacts: [...contacts, alias], patients: family,
    onSave: () => { writes++; }, onDelete: () => { writes++; } });
  const sections = () => h.elements.filter(item => item.type === 'button' && item.props['aria-controls']?.endsWith('-results'));
  assert.deepEqual(sections().map(item => text(item)), ['الكل3دليل موحد', 'لهم ملفات2مع أرقام الملفات', 'بدون ملفات1جهات اتصال فقط']);
  assert.equal(sections()[0].props['aria-pressed'], true);
  assert.equal(h.elements.filter(item => item.props.className === 'cc-group').length, 2);
  sections()[1].props.onClick(); h.render();
  assert.equal(h.elements.filter(item => item.type === 'article').length, 2);
  assert.equal(h.elements.filter(item => item.props.className === 'cc-group').length, 1);
  const shared = h.elements.find(item => item.props.name === alias.name)!;
  assert.deepEqual(shared.props.matches.map((item: any) => item.id), ['401', '402']);
  sections()[2].props.onClick(); h.render();
  assert.equal(h.elements.filter(item => item.type === 'article').length, 1);
  assert.ok(h.elements.some(item => item.props.name === contacts[0].name));
  sections()[0].props.onClick(); h.render();
  h.change(item => item.type === 'input' && item.props.type === 'search', 'أسرة مختلف');
  assert.deepEqual(sections().map(item => text(item)), ['الكل1دليل موحد', 'لهم ملفات1مع أرقام الملفات', 'بدون ملفات0جهات اتصال فقط']);
  assert.equal(writes, 0); assert.equal(contacts.length, 1); assert.equal(family.length, 3);
});

test('changing contact section resets pagination and patient registration immediately reclassifies an existing contact', () => {
  const manyPatients = Array.from({ length: 26 }, (_, i) => patient(String(i + 1), `مريض ${i + 1}`, `010${String(i).padStart(8, '0')}`));
  const manyContacts = Array.from({ length: 26 }, (_, i) => ({ ...contacts[0], id: `independent-${i}`, name: `رقم مستقل ${i + 1}`, mobile: `011${String(i).padStart(8, '0')}` }));
  const liveProps = { ...directoryProps, contacts: manyContacts, patients: manyPatients };
  const h = harness(compiled.exports.directory, liveProps);
  h.clickLabel('التالي');
  const choose = (prefix: string) => { h.find(item => item.type === 'button' && item.props['aria-controls']?.endsWith('-results') && text(item).startsWith(prefix)).props.onClick(); h.render(); };
  choose('بدون ملفات');
  assert.equal(h.elements.filter(item => item.type === 'article').length, 25);
  assert.match(h.content, /1 \/ 2/);
  const firstContact = manyContacts[0];
  liveProps.patients = [...manyPatients, patient('400', 'ملف مستحدث مصطنع', firstContact.mobile)]; h.render();
  assert.equal(h.elements.filter(item => item.type === 'article').length, 25);
  assert.ok(!h.elements.some(item => item.props.name === firstContact.name));
  choose('لهم ملفات');
  const moved = h.elements.find(item => item.props.name === firstContact.name);
  // Alphabetical placement may put the newly matched phone on the next page.
  if (!moved) { h.clickLabel('التالي'); }
  assert.ok(h.elements.some(item => item.props.matches?.some((match: any) => match.id === '400')));
  assert.equal(manyContacts.length, 26);
});

test('patient-create warnings are live/advisory and automatic numbering uses the actual ID returned by confirmed save', async () => {
  const saved: any[] = [], opened: string[] = [];
  const h = harness(compiled.exports.patients, { patients, contacts, currentUser: { id: 'synthetic-owner', role: 'doctor' }, onSavePatient: async (draft: any) => { saved.push(draft); return '411'; }, onDeletePatient() {}, onSelectPatient: (id: string) => opened.push(id), onBackToHome() {} });
  h.clickLabel('إضافة مريض');
  const fileInput = h.find(item => item.props.id === 'input-fileNo'); assert.equal(fileInput.props.value, '410'); assert.equal(fileInput.props.readOnly, true); assert.equal(fileInput.props.onChange, undefined);
  h.change(item => item.props.id === 'input-name', 'أحمد علي محمود'); h.change(item => item.props.id === 'input-mobile', '+201012345678'); h.change(item => item.props.id === 'input-age', '30');
  const warning = h.find(item => item.props.className === 'patient-registration-warnings');
  assert.match(text(warning), /#401|نفس رقم الموبايل واسم مشابه|لا يتم دمج/); assert.equal(saved.length, 0); assert.equal(opened.length, 0);
  await h.submit(); assert.equal(saved.length, 1); assert.equal(saved[0].id, '410'); assert.equal(saved[0].mobile, '01012345678'); assert.deepEqual(opened, ['411']);
  assert.equal(patients.length, 2); assert.equal(contacts.length, 1);
});

test('independent contact warning is visible and opening an existing file requires separate confirmation without creating/merging data', async () => {
  let writes = 0; const opened: string[] = [];
  const h = harness(compiled.exports.patients, { patients, contacts, currentUser: { id: 'synthetic-owner', role: 'doctor' }, onSavePatient: () => { writes++; }, onDeletePatient() {}, onSelectPatient: (id: string) => opened.push(id), onBackToHome() {} });
  h.clickLabel('إضافة مريض'); h.change(item => item.props.id === 'input-name', 'محمد علي محمود'); h.change(item => item.props.id === 'input-mobile', '01212345678');
  assert.match(text(h.find(item => item.props.className === 'patient-registration-warnings')), /جهة اتصال محفوظة|نفس رقم الموبايل/);
  h.change(item => item.props.id === 'input-mobile', '01012345678'); h.clickLabel('فتح الملف');
  assert.equal(opened.length, 0); assert.equal(writes, 0); assert.equal(h.confirmations.length, 1);
  await h.confirmations[0].onConfirm(); assert.deepEqual(opened, ['401']); assert.equal(writes, 0);
});

const whatsappSettings = { apiKey: '', webhookUrl: '', senderNumber: '', autoConfirmOnAppt: false, autoRemind24h: false, autoPostOpOnAttended: false,
  templates: { reminderTomorrow: 'موعد {patientName} {date} {time}', newAppt: 'موعد {patientName}', postOp: 'نص اختبار', accountBalance: '{remainingBalance}', greeting: 'تحية {patientName}', offer: 'إعلان {patientName}' }, campaignConsent: {} };

test('WhatsApp management embeds the same live unified directory, no stale separate-list copy or writes on render', () => {
  let writes = 0;
  const html = compiled.exports.renderManagement({ clinicName: 'عيادة اختبار', whatsappSettings, contacts: [], patients, onSaveContact: () => { writes++; }, onDeleteContact: () => { writes++; }, onSaveWhatsappSettings: () => { writes++; } });
  assert.match(html, /أرقام المرضى وجهات الاتصال|كل أرقام المرضى وجهات الاتصال|تجهيز حملة/);
  assert.equal((html.match(/data-contact-source="patient"/g) || []).length, 2);
  assert.doesNotMatch(html, /القائمة دي منفصلة عن ملفات المرضى|SYNTHETIC_CLINICAL_PRIVATE/); assert.equal(writes, 0);
});

test('shared contacts section navigates directly to campaigns while retaining the same patient/contact input arrays', () => {
  const h = harness(compiled.exports.management, { clinicName: 'عيادة اختبار', whatsappSettings, contacts, patients, onSaveContact() {}, onDeleteContact() {}, onSaveWhatsappSettings() {} });
  h.clickLabel('الأرقام');
  const child = h.find(item => typeof item.type === 'function' && item.props.onOpenCampaigns);
  assert.equal(child.props.patients, patients); assert.equal(child.props.contacts, contacts);
  child.props.onOpenCampaigns(); h.render();
  assert.equal(h.find(item => item.type === 'button' && text(item) === 'الحملات').props['aria-pressed'], true);
});

test('an unsaved library edit cannot silently become the live individual or campaign template',()=>{
 const h=harness(compiled.exports.management,{clinicName:'عيادة اختبار',whatsappSettings,contacts,patients,onSaveContact(){},onDeleteContact(){},onSaveWhatsappSettings(){}});
 h.change(n=>n.type==='textarea'&&n.props.id==='wa-template-text','مسودة لم تُحفظ');
 assert.equal(h.find(n=>n.type==='textarea'&&n.props.id==='wa-template-text').props.value,'مسودة لم تُحفظ');
 assert.doesNotMatch(h.find(n=>n.type==='textarea'&&n.props.id==='wa-individual-text').props.value,/مسودة لم تُحفظ/);
 const campaign=h.find(n=>typeof n.type==='function'&&n.props.settings&&n.props.onSave);
 assert.equal(campaign.props.settings,whatsappSettings);
});

test('individual WhatsApp selection labels an unfiled visit honestly without displaying its internal ID as a paper file',()=>{
 const visitor={...patients[0],id:'unfiled:synthetic-hidden-id',withoutFile:true};
 const h=harness(compiled.exports.management,{clinicName:'عيادة اختبار',whatsappSettings,contacts:[],patients:[visitor],onSaveContact(){},onDeleteContact(){},onSaveWhatsappSettings(){}});
 h.find(n=>n.type==='button'&&text(n).includes(visitor.name)&&text(n).includes('بدون ملف')).props.onClick();h.render();
 const picked=h.find(n=>n.props.className==='wa-picked-patient');assert.match(text(picked),/بدون ملف/);assert.doesNotMatch(text(picked),/unfiled:synthetic-hidden-id|ملف #/);
});

test('campaign audience includes patient phones once, preserves file labels and requires saved opt-in without inventing consent', () => {
  const family = [...patients, patient('402', 'اسم أسرة مختلف', '+201012345678')];
  const aliasContact = { ...contacts[0], id: 'alias', name: 'اسم اتصال لنفس الرقم', mobile: '01012345678' };
  const h = harness(compiled.exports.campaigns, { patients: family, contacts: [...contacts, aliasContact], settings: whatsappSettings, clinicName: 'عيادة اختبار', onSave() {} });
  const rows = h.elements.filter(item => item.props.className?.startsWith('wa-audience-row'));
  assert.equal(rows.length, 3); assert.match(h.content, /ملفات #401، #402|ملف #409|جهة اتصال بدون ملف/);
  for (const row of rows) {
    const checkbox = all(row).find(item => item.type === 'input' && item.props.type === 'checkbox'); assert.ok(checkbox);
    assert.equal(checkbox.props.disabled, true); assert.equal(checkbox.props.checked, false);
  }
  h.change(item => item.props['aria-label'] === 'بحث المستلمين للحملة', 'اسم أسرة مختلف');
  assert.equal(h.elements.filter(item => item.props.className?.startsWith('wa-audience-row')).length, 1);
  assert.deepEqual(whatsappSettings.campaignConsent, {});
});
