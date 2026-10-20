import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { Patient, Session } from '../types';
import type { ClinicDomainData } from './storage';
import { financialMoneyCents } from './financials';
import { getServiceGroup } from './serviceCatalog';
import { isValidAppointmentDate } from '../components/appointments/appointmentScheduling';

// Actual write boundary, invented records; never imports/hydrates App or reads storage.
const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let expression: ts.Expression | undefined;
const visit = (node: ts.Node): void => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'handleSaveSession') expression = node.initializer;
  ts.forEachChild(node, visit);
};
visit(ast); assert.ok(expression);
const code = ts.transpileModule(`return (${expression.getText(ast)});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const record = (changes: Partial<Session> = {}): Omit<Session, 'id'> => ({
  type: 'حشو عادي', tooth: null, date: '2026-10-10', amount: 100, paid: 0, remain: 100, paymentsLog: [], ...changes,
});
function harness() {
  const historical = { id: 'historical', ...record({ amount: 1.005, remain: 1.005 }) };
  let domain: ClinicDomainData = { patients: [{ id: 'synthetic-patient', name: 'مريض مصطنع', sessions: [historical], payments: [] } as unknown as Patient],
    contacts: [], appointments: [], labCases: [], expenses: [], materialUsages: [] };
  const actions: string[][] = [];
  const dependencies = { financialMoneyCents, getServiceGroup, isValidAppointmentDate,
    commitDomain: async (required: string[], mutate: (current: ClinicDomainData) => ClinicDomainData) => {
      actions.push(required); domain = mutate(domain);
    },
  };
  return { save: new Function('runtime', 'portable', ...Object.keys(dependencies), code)(undefined, null, ...Object.values(dependencies)) as
    (patientId: string, session: Omit<Session, 'id'>) => Promise<void>, current: () => structuredClone(domain), actions };
}

test('new generic services reject sub-cent totals, payments, discounts and breakdowns before a mutation', () => {
  for (const patch of [{ amount: 0.001 }, { paid: 0.001 }, { discount: 0.001 }, { examinationFee: 0.001 }, { treatmentFee: 0.001 },
    { services: [{ id: 'item', name: 'خدمة اختبار', price: 0.001 }] },
    { paymentsLog: [{ id: 'receipt', amount: 0.001, date: '2026-10-10' }] }]) {
    const h = harness();
    assert.throws(() => h.save('synthetic-patient', record(patch)), /منزلتين عشريتين/);
    assert.equal(h.actions.length, 0); assert.equal(h.current().patients[0].sessions.length, 1);
  }
});

test('new generic services store exact cents without changing existing fractional history', async () => {
  const h = harness(); const before = h.current().patients[0].sessions[0];
  await h.save('synthetic-patient', record({ amount: 0.1 + 0.2, paid: 0.3, remain: 0.0000001,
    examinationFee: 0.1, treatmentFee: 0.2, services: [{ id: 'item', name: 'خدمة اختبار', price: 0.2 }],
    paymentsLog: [{ id: 'receipt', amount: 0.1 + 0.2, date: '2026-10-10' }] }));
  const [saved, old] = h.current().patients[0].sessions;
  assert.equal(saved.amount, 0.3); assert.equal(saved.paid, 0.3); assert.equal(saved.remain, 0);
  assert.equal(saved.paymentsLog[0].amount, 0.3); assert.deepEqual(old, before);
  assert.deepEqual(h.actions, [['add_session', 'register_payment']]);
});

test('new generic services accept intended zero without payment authority and use cent-safe discounts', async () => {
  const free = harness(); await free.save('synthetic-patient', record({ amount: 0, paid: 0, remain: 999 }));
  assert.equal(free.current().patients[0].sessions[0].remain, 0);
  assert.deepEqual(free.actions, [['add_session']]);
  const h = harness(); await h.save('synthetic-patient', record({ amount: 0.3, paid: 0.1, discount: 0.2 }));
  assert.equal(h.current().patients[0].sessions[0].remain, 0);
  assert.throws(() => h.save('synthetic-patient', record({ amount: 0.3, paid: 0.2, discount: 0.2 })), /راجع/);
});
