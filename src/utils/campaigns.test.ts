import test from 'node:test';
import assert from 'node:assert/strict';
import { Patient } from '../types';
import { campaignRecipients } from './campaigns';

const patient = (id: string, mobile: string) => ({ id, name: `مريض ${id}`, mobile } as Patient);

test('campaign recipients include valid phones once in their first patient order', () => {
  const result = campaignRecipients([
    patient('401', '01012345678'),
    patient('402', '+20 101 234 5678'),
    patient('403', '01123456789'),
    patient('404', 'بدون رقم')
  ]);
  assert.deepEqual(result.map(item => [item.patient.id, item.phone]), [
    ['401', '201012345678'],
    ['403', '201123456789']
  ]);
});
