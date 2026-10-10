import test from 'node:test';
import assert from 'node:assert/strict';
import { createPatientRegistrationIndex, findPatientRegistrationMatches, getNextPatientFileNo, registrationNamesSimilar } from './patientRegistration';

const people = [
  { id: '401', name: 'أَحمد علي محمود', mobile: '+20 1012345678', notes: 'SYNTHETIC_PRIVATE' },
  { id: '402', name: 'سارة حسن', mobile: '01012345678', notes: 'SYNTHETIC_PRIVATE' },
  { id: '403', name: 'احمد علي محمرد', mobile: '01112345678', notes: 'SYNTHETIC_PRIVATE' },
];
const contacts = [{ id: 'saved-phone', name: 'أحمد علي', mobile: '٠١٠١٢٣٤٥٦٧٨', notes: 'SYNTHETIC_PRIVATE' }];

test('next file is one after the highest numeric file, starts at one and normalizes Arabic/Persian digits', () => {
  assert.equal(getNextPatientFileNo([]), '1');
  const records = Object.freeze([{ id: '101' }, { id: ' ٤٠٩ ' }, { id: '۰۰۴۱۰' }, { id: 'A999' }, { id: '410.5' }, { id: '-999' }, { id: '' }]);
  assert.equal(getNextPatientFileNo(records), '411');
  assert.equal(getNextPatientFileNo([{ id: '7' }, { id: '002' }]), '8');
  assert.equal(getNextPatientFileNo([{ id: '9007199254740992' }]), '9007199254740993');
  assert.equal(records[2].id, '۰۰۴۱۰');
});

test('matching index projects contact details only and does not retain patient notes/accounts', () => {
  const before = JSON.stringify({ people, contacts });
  const index = createPatientRegistrationIndex(people, contacts);
  assert.equal(index.length, 4); assert.ok(!JSON.stringify(index).includes('SYNTHETIC_PRIVATE'));
  assert.equal(JSON.stringify({ people, contacts }), before);
  assert.deepEqual(Object.keys(index[0]).sort(), ['id', 'mobile', 'name', 'normalizedName', 'phone', 'source']);
});

test('exact canonical full phone is strongest across all patient files and independent contacts', () => {
  const index = createPatientRegistrationIndex(people, contacts);
  const matches = findPatientRegistrationMatches(index, { name: 'احمد علي محمود', mobile: '٠١٠١٢٣٤٥٦٧٨' });
  assert.deepEqual(matches.map(match => [match.id, match.reason]), [['401', 'phone-and-name'], ['402', 'phone'], ['saved-phone', 'phone-and-name'], ['403', 'name']]);
  assert.equal(matches[0].fileNo, '401'); assert.equal(matches[2].fileNo, undefined);
  assert.deepEqual(findPatientRegistrationMatches(index, { name: '', mobile: '010123' }), []);
  assert.deepEqual(findPatientRegistrationMatches(index, { name: '', mobile: '01012345679' }), []);
});

test('similar names are conservative normalized multiword advisories, not first-name identity inference', () => {
  assert.equal(registrationNamesSimilar('احمد علي محمود', 'احمد علي محمرد'), true);
  assert.equal(registrationNamesSimilar('احمد علي محمود', 'احمد علي'), true);
  assert.equal(registrationNamesSimilar('احمد', 'احمد علي محمود'), false);
  assert.equal(registrationNamesSimilar('احمد علي محمود', 'احمد حسن محمود'), false);
  assert.equal(registrationNamesSimilar('سارة حسن', 'سارة حس'), true);
  const matches = findPatientRegistrationMatches(createPatientRegistrationIndex(people, []), { name: 'أَحْمد   عَلَى محمود', mobile: '' });
  assert.deepEqual(matches.map(match => [match.id, match.reason]), [['401', 'name'], ['403', 'name']]);
});

test('editing excludes only that patient, retaining family files and same-ID contact; output remains bounded', () => {
  const index = createPatientRegistrationIndex(people, [{ id: '401', name: 'اسم اتصال', mobile: '01012345678' }]);
  const matches = findPatientRegistrationMatches(index, { name: '', mobile: '01012345678' }, { excludePatientId: '401' });
  assert.deepEqual(matches.map(match => [match.source, match.id]), [['patient', '402'], ['contact', '401']]);
  assert.equal(findPatientRegistrationMatches(index, { name: '', mobile: '01012345678' }, { limit: 1 }).length, 1);
  assert.equal(findPatientRegistrationMatches(index, { name: '', mobile: '01012345678' }, { limit: 0 }).length, 0);
});
