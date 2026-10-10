import test from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '../types';
import { calculateToothBridgeRange, getSessionToothProcedure, getToothStatusForPatient, parseCompositeToothId, sessionIncludesTooth } from './toothUtils';

const mixed: Session = { id: 'synthetic-visit', date: '2026-10-10', type: 'خلع + حشو', tooth: null, amount: 100, paid: 20, remain: 80, paymentsLog: [],
  services: [{ id: 's1', name: 'خلع', price: 40, tooth: 'ur3' }, { id: 's2', name: 'حشو', price: 60, tooth: 'ul5' }] };

test('tooth parsing accepts only exact known quadrants and permanent or primary IDs', () => {
  for (const id of ['ur1', 'ul8', 'lrA', 'llE']) assert.ok(parseCompositeToothId(id));
  for (const id of ['zz1', 'ur1evil', 'ur01', 'ur0', 'ul9', 'urA1', 'ura', 'ur1 ', '']) assert.equal(parseCompositeToothId(id), null);
});
test('primary bridge ranges retain letters and never produce adult tooth IDs', () => {
  assert.deepEqual(calculateToothBridgeRange('urB', 'urD'), { teethIds: ['urB', 'urC', 'urD'], count: 3 });
  assert.deepEqual(calculateToothBridgeRange('ul5', 'ul3'), { teethIds: ['ul3', 'ul4', 'ul5'], count: 3 });
  assert.deepEqual(calculateToothBridgeRange('urB', 'ur3'), { teethIds: ['urB'], count: 1 });
});
test('multi-service visit uses each tooth procedure rather than painting every tooth with combined type', () => {
  assert.equal(sessionIncludesTooth(mixed, 'ur3'), true);
  assert.equal(sessionIncludesTooth(mixed, 'lr3'), false);
  assert.equal(getSessionToothProcedure(mixed, 'ur3'), 'خلع');
  assert.equal(getToothStatusForPatient([mixed], 'ur3').status, 'extracted');
  assert.equal(getToothStatusForPatient([mixed], 'ul5').status, 'filled');
  assert.equal(getToothStatusForPatient([mixed], 'lr3').hasHistory, false);
  assert.equal(mixed.amount, 100);
});
test('legacy single-tooth and bridge sessions retain history; consultation is not invented as a filling', () => {
  const legacy = { ...mixed, services: undefined, type: 'علاج عصب', tooth: 'ur3' };
  assert.equal(getToothStatusForPatient([legacy], 'ur3').status, 'endodontic');
  const bridge = { ...legacy, tooth: null, teethIds: ['ur3', 'ur4'], type: 'تركيبات - ثابتة' };
  assert.equal(getToothStatusForPatient([bridge], 'ur4').status, 'crown');
  const consultation = { ...legacy, type: 'كشف ومتابعة' };
  assert.equal(getToothStatusForPatient([consultation], 'ur3').status, 'normal');
  assert.equal(getToothStatusForPatient([consultation], 'ur3').hasHistory, true);
  assert.equal(getToothStatusForPatient([mixed, { ...legacy, date: '2026-10-11' }], 'ur3').status, 'endodontic');
});
