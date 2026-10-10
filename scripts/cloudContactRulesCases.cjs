'use strict';
// Pure fabricated before/after transaction contexts for the DEMO emulator only.
// No authentication, I/O, project selection, real accounts or production data.
const { createHash } = require('node:crypto');
const { namedCases: membershipCases } = require('./cloudMembershipRulesCases.cjs');
const UID = 'synthetic-contact-owner';
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const OP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OLD_OP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROOT = '/databases/(default)/documents/clinics/main';
const memberPath = `${ROOT}/members/${UID}`;
const recordPath = `${ROOT}/contactRecords/${ID}`;
const operationPath = `${ROOT}/contactOperations/${OP}`;
const key = phone => createHash('sha256').update(`contact-phone-v1:${phone}`).digest('hex');
const OLD_KEY = key('201012345678');
const NEXT_KEY = key('201123456789');
const oldPhonePath = `${ROOT}/contactPhones/${OLD_KEY}`;
const nextPhonePath = `${ROOT}/contactPhones/${NEXT_KEY}`;
const clone = value => structuredClone(value);
const document = data => ({ data });
const contact = { id: ID, name: 'Synthetic contact', mobile: '01012345678', createdAt: '2026-10-08T12:00:00.000Z', notes: 'Synthetic only' };
const record = (revision, op, data = contact) => ({ schemaVersion: 1, clinicId: 'main', recordId: ID, revision, deleted: data === null, lastOperationId: op,
  phoneKey: data === null ? null : data.mobile === '+20 11 2345 6789' ? NEXT_KEY : OLD_KEY, data: clone(data) });
const index = (phoneKey, recordId = ID) => ({ schemaVersion: 1, clinicId: 'main', phoneKey, recordId });
function fixture(kind = 'create') {
  const before = { [memberPath]: document({ schemaVersion: 1, clinicId: 'main', uid: UID, role: 'owner', status: 'active', identityVersion: 1, verifiedAfter: 1799999999 }) };
  if (kind !== 'create') {
    before[recordPath] = document(record(1, OLD_OP));
    before[oldPhonePath] = document(index(OLD_KEY));
  }
  const after = clone(before);
  const data = kind === 'delete' ? null : { ...contact, name: 'Updated synthetic', ...(kind === 'move' ? { mobile: '+20 11 2345 6789' } : {}) };
  after[recordPath] = document(record(kind === 'create' ? 1 : 2, OP, data));
  after[operationPath] = document({ schemaVersion: 1, clinicId: 'main', operationId: OP, actorUid: UID, recordId: ID,
    action: kind === 'create' ? 'create' : kind === 'delete' ? 'delete' : 'update',
    expectedRevision: kind === 'create' ? 0 : 1, resultRevision: kind === 'create' ? 1 : 2, requestHash: 'c'.repeat(64) });
  if (kind === 'move' || kind === 'delete') delete after[oldPhonePath];
  if (data) after[kind === 'move' ? nextPhonePath : oldPhonePath] = document(index(kind === 'move' ? NEXT_KEY : OLD_KEY));
  return { before, after, path: recordPath, method: kind === 'create' ? 'create' : 'update',
    auth: { uid: UID, token: { email_verified: true, firebase: { sign_in_provider: 'password' }, dentalClinicId: 'main', dentalClinicRole: 'owner', auth_time: 1800000000 } } };
}
function buildNamedCases() {
  const cases = membershipCases.map(entry => clone(entry));
  const add = (name, kind, expectation, mutate = () => {}) => {
    const state = fixture(kind); mutate(state);
    cases.push({ name, state, expectation });
  };
  const targets = [];
  for (const kind of ['create', 'update', 'move', 'delete']) {
    const components = [[recordPath, kind === 'create' ? 'create' : 'update'], [operationPath, 'create'],
      ...(kind === 'move' ? [[oldPhonePath, 'delete'], [nextPhonePath, 'create']]
        : [[oldPhonePath, kind === 'delete' ? 'delete' : kind === 'create' ? 'create' : 'update']])];
    for (const [path, method] of components) {
      const label = `${kind}/${path.split('/').at(-2)}/${method}`;
      targets.push({ kind, path, method, label });
      add(`${label} valid atomic context`, kind, 'ALLOW', s => { s.path = path; s.method = method; });
    }
  }
  for (const target of targets) {
    const mutations = {
      anonymous: s => { s.auth = null; },
      'unverified email': s => { s.auth.token.email_verified = false; },
      'non-password provider': s => { s.auth.token.firebase.sign_in_provider = 'anonymous'; },
      'secretary claim': s => { s.auth.token.dentalClinicRole = 'secretary'; },
      'other clinic claim': s => { s.auth.token.dentalClinicId = 'other'; },
      'membership missing': s => { delete s.before[memberPath]; },
      'membership disabled': s => { s.before[memberPath].data.status = 'disabled'; },
      'canonical secretary': s => { s.before[memberPath].data.role = 'secretary'; },
      'membership uid mismatch': s => { s.before[memberPath].data.uid = 'synthetic-other'; },
      'membership extra field': s => { s.before[memberPath].data.extra = true; },
      'old auth_time': s => { s.auth.token.auth_time = 1799999998; },
    };
    for (const [label, mutate] of Object.entries(mutations)) add(`${target.label} rejects ${label}`, target.kind, 'DENY', s => {
      s.path = target.path; s.method = target.method; mutate(s);
    });
  }
  for (const path of [recordPath, operationPath, oldPhonePath]) {
    add(`owner get ${path.split('/').at(-2)}`, 'update', 'ALLOW', s => { s.path = path; s.method = 'get'; });
    add(`owner get missing ${path.split('/').at(-2)}`, 'create', 'ALLOW', s => { s.path = path; s.method = 'get'; s.before = { [memberPath]: s.before[memberPath] }; });
    add(`deny list ${path.split('/').at(-2)}`, 'update', 'DENY', s => { s.path = path; s.method = 'list'; });
    add(`deny anonymous get ${path.split('/').at(-2)}`, 'update', 'DENY', s => { s.path = path; s.method = 'get'; s.auth = null; });
  }
  const list = (name, expectation, query, mutate = () => {}) => add(name, 'update', expectation, s => {
    s.path = `${ROOT}/contactRecords`; s.method = 'list'; s.query = clone(query); mutate(s);
  });
  for (const maximum of [1, 25, 50]) list(`owner bounded contact list ${maximum}`, 'ALLOW', { limit: maximum });
  list('owner contact list with UUID cursor', 'ALLOW', { limit: 25, afterId: ID });
  list('owner empty bounded contact list', 'ALLOW', { limit: 25 }, s => { delete s.before[recordPath]; });
  list('owner bounded contact list includes tombstones', 'ALLOW', { limit: 25 }, s => {
    s.before[recordPath].data.deleted = true; s.before[recordPath].data.phoneKey = null; s.before[recordPath].data.data = null;
  });
  list('contact list unbounded denied', 'DENY', {});
  list('contact list excessive limit denied', 'DENY', { limit: 51 });
  // Invalid specifications exercise the runner's query-contract boundary, not
  // a Rules request that Firestore's integer wire limit cannot represent.
  for (const invalid of [0, -1, 1.5, '25', null]) {
    list(`contact list invalid query limit ${JSON.stringify(invalid)}`, 'DENY', { limit: invalid }, s => { s.queryBoundary = true; });
  }
  for (const [label, mutate] of Object.entries({
    anonymous: s => { s.auth = null; },
    'unverified email': s => { s.auth.token.email_verified = false; },
    'non-password provider': s => { s.auth.token.firebase.sign_in_provider = 'anonymous'; },
    'secretary claim': s => { s.auth.token.dentalClinicRole = 'secretary'; },
    'other clinic claim': s => { s.auth.token.dentalClinicId = 'other'; },
    'membership missing': s => { delete s.before[memberPath]; },
    'membership disabled': s => { s.before[memberPath].data.status = 'disabled'; },
    'canonical secretary': s => { s.before[memberPath].data.role = 'secretary'; },
    'membership uid mismatch': s => { s.before[memberPath].data.uid = 'synthetic-other'; },
    'membership extra field': s => { s.before[memberPath].data.extra = true; },
    'stale auth_time': s => { s.auth.token.auth_time = 1799999998; },
  })) list(`bounded contact list rejects ${label}`, 'DENY', { limit: 25 }, mutate);
  for (const domain of ['contactPhones', 'contactOperations', 'members', 'patients', 'labPrivate', 'users']) {
    list(`bounded ${domain} list remains denied`, 'DENY', { limit: 25 }, s => { s.path = `${ROOT}/${domain}`; });
  }
  list('bounded other clinic contact list denied', 'DENY', { limit: 25 }, s => { s.path = s.path.replace('/main/', '/other/'); });
  list('bounded nondefault database contact list denied', 'DENY', { limit: 25 }, s => { s.path = s.path.replace('(default)', 'other'); });
  for (const [label, mutate] of Object.entries({
    'missing receipt': s => { delete s.after[operationPath]; },
    'reused receipt': s => { s.before[operationPath] = clone(s.after[operationPath]); },
    'missing phone': s => { delete s.after[oldPhonePath]; },
    'phone points elsewhere': s => { s.after[oldPhonePath].data.recordId = OTHER; },
    'wrong receipt actor': s => { s.after[operationPath].data.actorUid = 'synthetic-other'; },
    'wrong receipt action': s => { s.after[operationPath].data.action = 'update'; },
    'wrong receipt record': s => { s.after[operationPath].data.recordId = OTHER; },
    'wrong receipt result revision': s => { s.after[operationPath].data.resultRevision = 2; },
    'wrong receipt expected revision': s => { s.after[operationPath].data.expectedRevision = 1; },
  })) add(`create rejects ${label}`, 'create', 'DENY', mutate);
  for (const [label, mutate] of Object.entries({
    'unchanged revision': s => { s.after[recordPath].data.revision = 1; },
    'skipped revision': s => { s.after[recordPath].data.revision = 3; },
    'changed createdAt': s => { s.after[recordPath].data.data.createdAt = '2026-10-07T12:00:00Z'; },
    'changed record id': s => { s.after[recordPath].data.recordId = OTHER; },
    'reused last operation': s => { s.after[recordPath].data.lastOperationId = OLD_OP; },
    'missing old index': s => { delete s.before[oldPhonePath]; },
    'old index stolen': s => { s.before[oldPhonePath].data.recordId = OTHER; },
    'tombstone revival': s => { s.before[recordPath].data.deleted = true; s.before[recordPath].data.data = null; },
  })) add(`update rejects ${label}`, 'update', 'DENY', mutate);
  add('move requires old phone release', 'move', 'DENY', s => { s.after[oldPhonePath] = clone(s.before[oldPhonePath]); });
  add('move requires new phone reservation', 'move', 'DENY', s => { delete s.after[nextPhonePath]; });
  add('delete requires phone release', 'delete', 'DENY', s => { s.after[oldPhonePath] = clone(s.before[oldPhonePath]); });
  for (const kind of ['update', 'move', 'delete']) add(`${kind} Arabic previous and Persian next phone`, kind, 'ALLOW', s => {
    s.before[recordPath].data.data.mobile = '٠١٠١٢٣٤٥٦٧٨';
    if (kind !== 'delete') s.after[recordPath].data.data.mobile = kind === 'move' ? '۰۱۱۲۳۴۵۶۷۸۹' : '۰۱۰۱۲۳۴۵۶۷۸';
  });
  add('physical record delete is denied', 'delete', 'DENY', s => { s.method = 'delete'; });
  for (const method of ['update', 'delete']) add(`receipt ${method} denied`, 'update', 'DENY', s => { s.path = operationPath; s.method = method; s.before[operationPath] = clone(s.after[operationPath]); });
  add('standalone receipt denied', 'update', 'DENY', s => { s.path = operationPath; s.method = 'create'; s.after[recordPath] = clone(s.before[recordPath]); });
  add('standalone index create denied', 'create', 'DENY', s => { s.path = oldPhonePath; delete s.after[recordPath]; });
  add('standalone index update denied', 'update', 'DENY', s => { s.path = oldPhonePath; s.after[recordPath] = clone(s.before[recordPath]); });
  add('standalone index delete denied', 'delete', 'DENY', s => { s.path = oldPhonePath; s.method = 'delete'; s.after[recordPath] = clone(s.before[recordPath]); });
  add('cannot reassign existing phone index', 'move', 'DENY', s => { s.path = nextPhonePath; s.method = 'update'; s.before[nextPhonePath] = document(index(NEXT_KEY, OTHER)); });
  for (const [field, value] of [['schemaVersion', 2], ['requestHash', 'invalid'], ['operationId', OLD_OP], ['extra', true]]) {
    add(`reject coupled receipt ${field}`, 'create', 'DENY', s => { s.after[operationPath].data[field] = value; });
  }
  add('reject coupled receipt missing requestHash', 'create', 'DENY', s => { delete s.after[operationPath].data.requestHash; });
  for (const [field, value] of [['schemaVersion', 2], ['phoneKey', NEXT_KEY], ['extra', true]]) {
    add(`reject coupled index ${field}`, 'create', 'DENY', s => { s.after[oldPhonePath].data[field] = value; });
  }
  add('reject coupled index missing phoneKey', 'create', 'DENY', s => { delete s.after[oldPhonePath].data.phoneKey; });
  add('reject forged record phone hash with matching forged index', 'create', 'DENY', s => {
    s.after[recordPath].data.phoneKey = NEXT_KEY; delete s.after[oldPhonePath]; s.after[nextPhonePath] = document(index(NEXT_KEY));
  });
  add('reject tombstone retaining phone hash', 'delete', 'DENY', s => { s.after[recordPath].data.phoneKey = OLD_KEY; });
  const phoneValues = ['01012345678', '+201012345678', '00201012345678', '٠١٠١٢٣٤٥٦٧٨', '+۲۰ ۱۰ ۱۲۳۴ ۵۶۷۸', ' (010) 123-45.678 ', '001012345678', '+1 (202) 555-0123', '\u00a001012345678\u00a0', '\ufeff01012345678\ufeff'];
  for (const phone of phoneValues) {
    // Expected canonical outputs are explicit, not calculated by candidate rules.
    const canonical = phone === '+1 (202) 555-0123' ? '12025550123' : phone === '001012345678' ? '1012345678' : '201012345678';
    add(`phone parity valid ${phone}`, 'create', 'ALLOW', s => {
      s.after[recordPath].data.data.mobile = phone;
      delete s.after[oldPhonePath]; const phoneKey = key(canonical);
      s.after[recordPath].data.phoneKey = phoneKey;
      s.after[`${ROOT}/contactPhones/${phoneKey}`] = document(index(phoneKey));
    });
  }
  for (const phone of ['0101234567', '+20101234567', '010123456789', '01012345678 ext1', '++201012345678', '010\n12345678', '+20 2 12345678', '0000000000', '０１０１２３４５６７８']) {
    add(`phone parity invalid ${JSON.stringify(phone)}`, 'create', 'DENY', s => { s.after[recordPath].data.data.mobile = phone; });
  }
  for (const [field, value] of [['schemaVersion', 2], ['schemaVersion', 1.5], ['clinicId', 'other'], ['recordId', OTHER], ['revision', 0], ['revision', 1.5], ['revision', 2000000001], ['deleted', 'false'], ['lastOperationId', 'invalid'], ['data', null], ['extra', true]]) {
    add(`reject record ${field}=${JSON.stringify(value)}`, 'create', 'DENY', s => { s.after[recordPath].data[field] = value; });
  }
  for (const field of Object.keys(record(1, OP))) add(`reject missing record ${field}`, 'create', 'DENY', s => { delete s.after[recordPath].data[field]; });
  for (const [field, value] of [['id', OTHER], ['name', '   '], ['name', 'a'.repeat(201)], ['name', 'a\nb\nc'], ['notes', 'a'.repeat(2001)], ['notes', 'a\n\u0001\nb'], ['notes', null], ['mobile', 1234], ['createdAt', '2026-02-29T12:00:00Z'], ['createdAt', '2024-04-31T12:00:00Z'], ['createdAt', '2026-10-08T24:00:00Z'], ['extra', true]]) {
    add(`reject contact ${field}=${JSON.stringify(value).slice(0, 70)}`, 'create', 'DENY', s => { s.after[recordPath].data.data[field] = value; });
  }
  add('allows notes newline tab and carriage return', 'create', 'ALLOW', s => { s.after[recordPath].data.data.notes = 'a\nb\tc\rd'; });
  add('allows Gregorian leap date', 'create', 'ALLOW', s => { s.after[recordPath].data.data.createdAt = '2024-02-29T12:00:00Z'; });
  add('allows omitted notes', 'create', 'ALLOW', s => { delete s.after[recordPath].data.data.notes; });
  for (const name of ['\u00a0', '\ufeff']) add(`reject Unicode whitespace-only name ${JSON.stringify(name)}`, 'create', 'DENY', s => { s.after[recordPath].data.data.name = name; });
  for (const path of [`${ROOT}/patients/${ID}`, `${ROOT}/labPrivate/${ID}`, `${ROOT}/users/${UID}`, recordPath.replace('/main/', '/other/'), recordPath.replace('(default)', 'other')]) {
    for (const method of ['get', 'list', 'create']) add(`closed ${method} ${path}`, 'create', 'DENY', s => { s.path = path; s.method = method; });
  }
  return cases;
}
module.exports = { namedCases: buildNamedCases(), buildNamedCases, ROOT, UID, key, fixture, recordPath, operationPath, oldPhonePath, nextPhonePath };
