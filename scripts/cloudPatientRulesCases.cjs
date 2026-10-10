'use strict';
// Fabricated DEMO-only contexts. No I/O, real identities or project selection.
const { createHash } = require('node:crypto');
const UID = 'synthetic-patient-owner';
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const OP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OLD_OP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROOT = '/databases/(default)/documents/clinics/main';
const paths = { member: `${ROOT}/members/${UID}`, profile: `${ROOT}/patientProfiles/${ID}`,
  operation: `${ROOT}/patientOperations/${OP}`, file: `${ROOT}/patientFiles/1`, counter: `${ROOT}/counters/patientFiles` };
const clone = value => structuredClone(value);
const phoneKey = value => createHash('sha256').update(`patient-phone-v1:${value}`).digest('hex');
const profile = { name: 'Synthetic patient', mobile: '01012345678', age: 30, gender: '',
  firstVisit: '2026-10-10', notes: 'Fabricated only', allergy: '' };
const envelope = (revision, operationId) => ({ schemaVersion: 1, clinicId: 'main', recordId: ID, fileNo: 1, revision,
  lastOperationId: operationId, phoneKey: phoneKey('201012345678'), data: clone(profile) });
const counter = (lastFileNo, lastOperationId) => ({ schemaVersion: 1, clinicId: 'main', lastFileNo, lastOperationId });
function fixture(kind = 'create') {
  const before = { [paths.member]: { schemaVersion: 1, clinicId: 'main', uid: UID, role: 'owner', status: 'active', identityVersion: 1, verifiedAfter: 1799999999 },
    [paths.counter]: counter(kind === 'create' ? 0 : 1, kind === 'create' ? null : OLD_OP) };
  if (kind === 'update') {
    before[paths.profile] = envelope(1, OLD_OP);
    before[paths.file] = { schemaVersion: 1, clinicId: 'main', fileNo: 1, recordId: ID };
  }
  const writes = { [paths.profile]: envelope(kind === 'create' ? 1 : 2, OP),
    [paths.operation]: { schemaVersion: 1, clinicId: 'main', operationId: OP, actorUid: UID, recordId: ID, fileNo: 1,
      action: kind, expectedRevision: kind === 'create' ? 0 : 1, resultRevision: kind === 'create' ? 1 : 2, requestHash: 'c'.repeat(64) } };
  if (kind === 'create') {
    writes[paths.counter] = counter(1, OP);
    writes[paths.file] = { schemaVersion: 1, clinicId: 'main', fileNo: 1, recordId: ID };
  }
  return { before, writes, path: paths.profile, method: 'write',
    auth: { uid: UID, token: { email_verified: true, firebase: { sign_in_provider: 'password' }, dentalClinicId: 'main', dentalClinicRole: 'owner', auth_time: 1800000000 } } };
}
function buildCases() {
  const cases = [];
  const add = (name, kind, allowed, mutate = () => {}) => { const state = fixture(kind); mutate(state); cases.push({ name, state, allowed }); };
  for (const kind of ['create', 'update']) {
    add(`valid atomic ${kind}`, kind, true);
    const deniedIdentity = {
      anonymous: s => { s.auth = null; }, unverified: s => { s.auth.token.email_verified = false; },
      secretary: s => { s.auth.token.dentalClinicRole = 'secretary'; }, otherClinic: s => { s.auth.token.dentalClinicId = 'other'; },
      otherProvider: s => { s.auth.token.firebase.sign_in_provider = 'google.com'; },
      oldAuth: s => { s.auth.token.auth_time = 1799999998; }, malformedAuthTime: s => { s.auth.token.auth_time = '1800000000'; },
      noMember: s => { delete s.before[paths.member]; }, disabledMember: s => { s.before[paths.member].status = 'disabled'; },
      wrongMemberUid: s => { s.before[paths.member].uid = 'synthetic-other'; }, canonicalSecretary: s => { s.before[paths.member].role = 'secretary'; },
      memberExtra: s => { s.before[paths.member].extra = true; }, memberVersion: s => { s.before[paths.member].identityVersion = 0; },
    };
    for (const [label, mutate] of Object.entries(deniedIdentity)) add(`${kind} rejects ${label}`, kind, false, mutate);
    add(`${kind} requires receipt`, kind, false, s => { delete s.writes[paths.operation]; });
    add(`${kind} rejects existing receipt`, kind, false, s => { s.before[paths.operation] = clone(s.writes[paths.operation]); delete s.writes[paths.operation]; });
    add(`${kind} rejects profile only`, kind, false, s => { s.writes = { [paths.profile]: s.writes[paths.profile] }; });
    add(`${kind} rejects receipt only`, kind, false, s => { s.writes = { [paths.operation]: s.writes[paths.operation] }; });
    for (const [field, invalid] of Object.entries({ schemaVersion: 2, clinicId: 'other', recordId: OTHER, fileNo: 0,
      revision: 2000000001, lastOperationId: OLD_OP, phoneKey: 'd'.repeat(64), data: null, extra: true })) {
      add(`${kind} rejects envelope ${field}`, kind, false, s => { s.writes[paths.profile][field] = invalid; });
    }
    for (const field of ['schemaVersion', 'clinicId', 'recordId', 'fileNo', 'revision', 'lastOperationId', 'phoneKey', 'data']) {
      add(`${kind} rejects missing envelope ${field}`, kind, false, s => { delete s.writes[paths.profile][field]; });
    }
    for (const [field, invalid] of Object.entries({ name: ' ', mobile: 'call me 01012345678', age: 121, gender: ' male ',
      firstVisit: '2026-02-30', notes: '\u0000bad', allergy: '\u007fbad', sessions: [], payments: [], labCost: 99 })) {
      add(`${kind} rejects profile ${field}`, kind, false, s => { s.writes[paths.profile].data[field] = invalid; });
    }
    for (const field of Object.keys(profile)) add(`${kind} rejects missing profile ${field}`, kind, false, s => { delete s.writes[paths.profile].data[field]; });
    for (const [field, invalid] of Object.entries({ schemaVersion: 2, clinicId: 'other', operationId: OLD_OP, actorUid: 'synthetic-other', recordId: OTHER,
      fileNo: 2, action: 'delete', expectedRevision: -1, resultRevision: 2000000001, requestHash: 'not-a-hash', extra: true })) {
      add(`${kind} rejects receipt ${field}`, kind, false, s => { s.writes[paths.operation][field] = invalid; });
    }
    for (const field of ['actorUid', 'recordId', 'fileNo', 'action', 'expectedRevision', 'resultRevision', 'requestHash']) {
      add(`${kind} rejects missing receipt ${field}`, kind, false, s => { delete s.writes[paths.operation][field]; });
    }
    add(`${kind} allows empty mobile`, kind, true, s => { s.writes[paths.profile].data.mobile = ''; s.writes[paths.profile].phoneKey = null; });
    add(`${kind} allows Arabic phone`, kind, true, s => { s.writes[paths.profile].data.mobile = '+٢٠ ١٠ ١٢٣٤ ٥٦٧٨'; });
    add(`${kind} allows Persian phone`, kind, true, s => { s.writes[paths.profile].data.mobile = '۰۱۰۱۲۳۴۵۶۷۸'; });
    add(`${kind} allows international phone`, kind, true, s => { s.writes[paths.profile].data.mobile = '+44 7700 900123'; s.writes[paths.profile].phoneKey = phoneKey('447700900123'); });
    add(`${kind} allows multiline notes allergy`, kind, true, s => { s.writes[paths.profile].data.notes = 'a\nb\rc\td'; s.writes[paths.profile].data.allergy = 'a\nb\tc'; });
    for (const [label, values] of Object.entries({ trimmedName: { name: ' Patient' }, trimmedMobile: { mobile: '01012345678 ' },
      emptyName: { name: '' }, nameControls: { name: 'a\nb' }, nameLimit: { name: 'a'.repeat(201) }, notesLimit: { notes: 'a'.repeat(4001) },
      allergyLimit: { allergy: 'a'.repeat(1001) }, genderLimit: { gender: 'a'.repeat(41) }, invalidLeap: { firstVisit: '2025-02-29' },
      oldDate: { firstVisit: '1899-12-31' }, malformedDate: { firstVisit: '2026-1-1' }, fractionalAge: { age: 1.5 }, negativeAge: { age: -1 } })) {
      add(`${kind} rejects ${label}`, kind, false, s => { Object.assign(s.writes[paths.profile].data, values); });
    }
    add(`${kind} allows valid leap`, kind, true, s => { s.writes[paths.profile].data.firstVisit = '2000-02-29'; });
  }
  for (const field of ['counter', 'file']) add(`create requires ${field}`, 'create', false, s => { delete s.writes[paths[field]]; });
  add('create missing counter fails closed', 'create', false, s => { delete s.before[paths.counter]; });
  add('create cannot bootstrap counter', 'create', false, s => { delete s.before[paths.counter]; s.writes[paths.counter] = counter(0, null); });
  add('create corrupt counter fails closed', 'create', false, s => { s.before[paths.counter].extra = true; });
  add('create zero counter with op fails closed', 'create', false, s => { s.before[paths.counter].lastOperationId = OLD_OP; });
  add('create positive counter null op fails closed', 'create', false, s => { s.before[paths.counter] = counter(1, null); });
  add('create fractional counter fails closed', 'create', false, s => { s.before[paths.counter] = counter(0.5, OLD_OP); });
  add('create exhausted counter fails closed', 'create', false, s => { s.before[paths.counter] = counter(2000000000, OLD_OP); });
  add('create counter schema mutation denied', 'create', false, s => { s.writes[paths.counter].schemaVersion = 2; });
  for (const field of ['schemaVersion', 'lastFileNo']) add(`create counter integral double ${field} denied`, 'create', false, s => {
    // JS SDK normally encodes integral values as int. Explicit wire fixtures
    // exercise the actual Rules int-vs-double boundary without real records.
    s.doubleFields = [[paths.counter, field]];
  });
  add('create counter extra denied', 'create', false, s => { s.writes[paths.counter].extra = true; });
  add('create valid monotonic next number', 'create', true, s => {
    s.before[paths.counter] = counter(400, OLD_OP); s.writes[paths.counter] = counter(401, OP);
    s.writes[paths.profile].fileNo = 401; s.writes[paths.operation].fileNo = 401;
    s.writes[`${ROOT}/patientFiles/401`] = { ...s.writes[paths.file], fileNo: 401 }; delete s.writes[paths.file];
  });
  add('create counter jump denied', 'create', false, s => { s.writes[paths.counter].lastFileNo = 2; });
  add('create counter reset denied', 'create', false, s => { s.writes[paths.counter] = counter(0, null); });
  add('create counter op mismatch denied', 'create', false, s => { s.writes[paths.counter].lastOperationId = OLD_OP; });
  add('standalone counter increment denied', 'create', false, s => { s.writes = { [paths.counter]: s.writes[paths.counter] }; });
  add('standalone file denied', 'create', false, s => { s.writes = { [paths.file]: s.writes[paths.file] }; });
  add('create occupied file denied', 'create', false, s => { s.before[paths.file] = { ...s.writes[paths.file], recordId: OTHER }; });
  add('create file mismatch denied', 'create', false, s => { s.writes[paths.file].recordId = OTHER; });
  add('create file extra denied', 'create', false, s => { s.writes[paths.file].extra = true; });
  add('create noncanonical file key denied', 'create', false, s => { s.writes[`${ROOT}/patientFiles/01`] = s.writes[paths.file]; delete s.writes[paths.file]; });
  add('create duplicate counter allocation denied', 'create', false, s => {
    s.writes[`${ROOT}/patientProfiles/${OTHER}`] = { ...clone(s.writes[paths.profile]), recordId: OTHER };
  });
  add('update file number immutable', 'update', false, s => { s.writes[paths.profile].fileNo = 2; s.writes[paths.operation].fileNo = 2; });
  add('update revision CAS denied', 'update', false, s => { s.writes[paths.profile].revision = 3; s.writes[paths.operation].resultRevision = 3; s.writes[paths.operation].expectedRevision = 2; });
  add('update cannot alter counter', 'update', false, s => { s.writes[paths.counter] = counter(2, OP); });
  add('new receipt cannot bless unchanged profile', 'update', false, s => {
    s.writes = { [paths.operation]: s.writes[paths.operation] };
    s.writes[paths.operation].resultRevision = 1; s.writes[paths.operation].expectedRevision = 0; s.writes[paths.operation].action = 'create';
  });
  add('create file number independently mismatched', 'create', false, s => { s.writes[paths.file].fileNo = 2; });
  add('create receipt file number independently mismatched', 'create', false, s => { s.writes[paths.operation].fileNo = 2; });
  add('create profile file number independently mismatched', 'create', false, s => { s.writes[paths.profile].fileNo = 2; });
  add('update cannot rewrite file index even unchanged', 'update', false, s => { s.writes[paths.file] = clone(s.before[paths.file]); });
  add('profile physical deletion denied', 'update', false, s => { s.writes = { [paths.profile]: null }; });
  add('counter deletion denied', 'update', false, s => { s.writes = { [paths.counter]: null }; });
  add('file deletion denied', 'update', false, s => { s.writes = { [paths.file]: null }; });
  add('receipt mutation denied', 'update', false, s => { s.before[paths.operation] = clone(s.writes[paths.operation]); s.writes = { [paths.operation]: { ...s.writes[paths.operation], requestHash: 'e'.repeat(64) } }; });
  add('receipt deletion denied', 'update', false, s => { s.before[paths.operation] = clone(s.writes[paths.operation]); s.writes = { [paths.operation]: null }; });
  for (const key of ['profile', 'file', 'counter', 'operation']) {
    add(`owner get ${key}`, 'update', true, s => { s.method = 'get'; s.path = paths[key]; if (key === 'operation') s.before[paths.operation] = clone(s.writes[paths.operation]); });
    add(`owner get missing ${key}`, 'create', true, s => { s.method = 'get'; s.path = paths[key]; delete s.before[s.path]; });
    add(`secretary get ${key} denied`, 'update', false, s => { s.method = 'get'; s.path = paths[key]; s.auth.token.dentalClinicRole = 'secretary'; });
    add(`anonymous get ${key} denied`, 'update', false, s => { s.method = 'get'; s.path = paths[key]; s.auth = null; });
    add(`unbounded list ${key} denied`, 'update', false, s => { s.method = 'list'; s.path = paths[key].split('/').slice(0, -1).join('/'); });
  }
  add('owner cannot read another actor receipt', 'update', false, s => { s.method = 'get'; s.path = paths.operation; s.before[s.path] = { ...s.writes[paths.operation], actorUid: 'synthetic-other' }; });
  for (const maximum of [1, 25, 50]) add(`bounded profiles ${maximum}`, 'update', true, s => { s.method = 'list'; s.path = `${ROOT}/patientProfiles`; s.limit = maximum; });
  add('excessive profile list denied', 'update', false, s => { s.method = 'list'; s.path = `${ROOT}/patientProfiles`; s.limit = 51; });
  add('secretary bounded profile list denied', 'update', false, s => { s.method = 'list'; s.path = `${ROOT}/patientProfiles`; s.limit = 25; s.auth.token.dentalClinicRole = 'secretary'; });
  add('bounded receipt list denied', 'update', false, s => { s.method = 'list'; s.path = `${ROOT}/patientOperations`; s.limit = 25; });
  for (const path of [`${ROOT}/patientFiles/01`, `${ROOT}/patientFiles/0`, `${ROOT}/patientFiles/2000000001`, `${ROOT}/patientProfiles/not-uuid`,
    `${ROOT}/patientOperations/not-uuid`, `${ROOT}/expenses/test`, `${ROOT}/contactRecords/${ID}`, '/databases/(default)/documents/clinics/other/patientProfiles/' + ID]) {
    add(`forbidden get ${path}`, 'update', false, s => { s.method = 'get'; s.path = path; });
  }
  return cases;
}
module.exports = { UID, ID, OP, OLD_OP, ROOT, paths, profile, phoneKey, fixture, namedCases: buildCases() };
