import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfirmedActionExecutor } from './confirmedAction';

test('confirmed save waits before success and rejects a duplicate pending action', async () => {
  const states: boolean[] = [];
  const errors: unknown[] = [];
  const run = createConfirmedActionExecutor(value => states.push(value), error => errors.push(error));
  let resolve!: () => void; let success = 0; let actions = 0;
  const pending = new Promise<void>(done => { resolve = done; });
  const save = run(() => { actions++; return pending; }, () => success++);
  assert.deepEqual(states, [true]); assert.equal(success, 0);
  assert.equal(await run(() => { actions++; }, () => success++), false);
  assert.equal(actions, 1); resolve(); assert.equal(await save, true);
  assert.equal(success, 1); assert.deepEqual(states, [true, false]); assert.deepEqual(errors, []);
});

test('failed persistence retains financial drafts and permits an explicit retry', async () => {
  const error = new Error('quota'); const failures: unknown[] = []; let draft = 'invoice data';
  const run = createConfirmedActionExecutor(() => {}, value => failures.push(value));
  assert.equal(await run(async () => { throw error; }, () => { draft = ''; }), false);
  assert.equal(draft, 'invoice data'); assert.deepEqual(failures, [error]);
  assert.equal(await run(async () => {}, () => { draft = ''; }), true); assert.equal(draft, '');
});

test('synchronous mutation failure never reports success or closes a modal', async () => {
  let open = true; const error = new Error('invalid amount'); const failures: unknown[] = [];
  const run = createConfirmedActionExecutor(() => {}, value => failures.push(value));
  assert.equal(await run(() => { throw error; }, () => { open = false; }), false);
  assert.equal(open, true); assert.deepEqual(failures, [error]);
});
