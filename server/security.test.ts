import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApiApp, mountProductionWebsite, ServerOptions } from '../server';
import { MAX_IMAGE_BYTES, validateAiPayload } from './security';

const env = { NODE_ENV: 'production', AI_AUTH_ENABLED: 'true', GEMINI_API_KEY: 'fake-test-key-never-used',
  AI_FIREBASE_PROJECT_ID: 'test-project', AI_ALLOWED_UIDS: 'doctor-uid', AI_ALLOWED_ORIGINS: 'https://clinic.example',
  AI_USE_APPLICATION_DEFAULT_CREDENTIALS: 'true' };
const finance = { currentMonthRevenue: 1000, currentMonthExpenses: 200, categoryTotals: { supplies: 200 } };
const headers = { 'Content-Type': 'application/json', Origin: 'https://clinic.example', Authorization: 'Bearer valid-test-token' };
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]).toString('base64');

async function fixture(options: ServerOptions = {}) {
  let calls = 0;
  const app = createApiApp({ env, verifyToken: async () => ({ uid: 'doctor-uid' }),
    createAiClient: () => ({ models: { generateContent: async () => { calls++; return { text: '{"insights":["test"],"recommendation":"test"}' }; } } } as any), ...options });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  return { app, url, calls: () => calls, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); },
    post: (body: unknown = finance, extra: Record<string, string> = {}, route = '/financial-insights') => fetch(url + '/api/ai' + route, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) }) };
}

test('AI fails closed with no setup, a partial setup, or an Auth emulator; no verifier/provider call', async () => {
  for (const changed of [{}, { ...env, AI_ALLOWED_UIDS: '' }, { ...env, AI_ALLOWED_ORIGINS: 'https://clinic.example/path' },
    { ...env, GOOGLE_APPLICATION_CREDENTIALS: undefined, AI_USE_APPLICATION_DEFAULT_CREDENTIALS: 'false' }, { ...env, FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' }]) {
    let verifies = 0;
    const f = await fixture({ env: changed, verifyToken: async () => { verifies++; return { uid: 'doctor-uid' }; } });
    try { const response = await f.post(); assert.equal(response.status, 503); assert.equal(verifies, 0); assert.equal(f.calls(), 0); }
    finally { await f.close(); }
  }
});

test('auth rejects absent, malformed, forged and non-allowed identities before AI', async () => {
  const f = await fixture({ verifyToken: async token => { if (token !== 'valid-test-token') throw new Error('secret-key-in-raw-error'); return { uid: 'not-allowed' }; } });
  try {
    for (const auth of ['', 'Basic local-demo-password', 'Bearer token,spoofed', 'Bearer forged-token']) {
      const response = await f.post(finance, { Authorization: auth }); assert.equal(response.status, 401);
      assert.ok(!(await response.text()).includes('secret-key-in-raw-error'));
    }
    assert.equal((await f.post()).status, 403); assert.equal(f.calls(), 0);
  } finally { await f.close(); }
});

test('only exact approved browser origins and uncompressed JSON reach authenticated routes', async () => {
  const f = await fixture();
  try {
    for (const origin of ['', 'https://evil.example', 'https://clinic.example.evil.example', 'null']) assert.equal((await f.post(finance, { Origin: origin })).status, 403);
    assert.equal((await f.post(finance, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await f.post(finance, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await f.post(finance, { 'Content-Encoding': 'gzip' })).status, 415);
    const valid = await f.post(); assert.equal(valid.status, 200); assert.equal(valid.headers.get('cache-control'), 'no-store'); assert.equal(f.calls(), 1);
  } finally { await f.close(); }
});

test('per-IP unauthenticated limit cannot be bypassed by a spoofed forwarding header', async () => {
  const f = await fixture({ requestLimit: 2 });
  try {
    assert.equal((await f.post(finance, { Authorization: '' })).status, 401);
    assert.equal((await f.post(finance, { Authorization: '' })).status, 401);
    const blocked = await f.post(finance, { 'X-Forwarded-For': '203.0.113.99' });
    assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '60'); assert.equal(f.calls(), 0);
  } finally { await f.close(); }
});

test('UID/global call limits expire and stop extra provider calls', async () => {
  let now = 0;
  const f = await fixture({ now: () => now, userMinuteLimit: 2, userHourLimit: 3, globalHourLimit: 3 });
  try {
    assert.equal((await f.post()).status, 200); assert.equal((await f.post()).status, 200);
    assert.equal((await f.post()).status, 429); now = 61_000;
    assert.equal((await f.post()).status, 200); assert.equal((await f.post()).status, 429);
    assert.equal(f.calls(), 3); now = 3_600_001; assert.equal((await f.post()).status, 200); assert.equal(f.calls(), 4);
  } finally { await f.close(); }
});

test('concurrency admission remains held during a pending provider call and is released afterward', async () => {
  let release!: () => void;
  const providerReady = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const isStarted = new Promise<void>(resolve => { started = resolve; });
  let calls = 0;
  const f = await fixture({ createAiClient: () => ({ models: { generateContent: async () => { calls++; started(); await providerReady; return { text: '{}' }; } } } as any) });
  try {
    const first = f.post(); await isStarted;
    assert.equal((await f.post()).status, 429); assert.equal(calls, 1);
    release(); assert.equal((await first).status, 200); assert.equal((await f.post()).status, 200); assert.equal(calls, 2);
  } finally { release(); await f.close(); }
});

test('all six AI endpoints validate payloads before a provider call; errors disclose no provider detail', async () => {
  const f = await fixture();
  try {
    for (const route of ['/extract-invoice', '/endodontic-helper', '/smart-search', '/schedule-assistant', '/financial-insights', '/clinical-summary']) {
      assert.equal((await f.post({}, {}, route)).status, 400);
      assert.equal((await f.post(null, {}, route)).status, 400);
    }
    assert.equal(f.calls(), 0);
    assert.equal((await f.post({ ...finance, currentMonthRevenue: -1 })).status, 400);
    assert.equal((await f.post({ query: 'x', patients: [{ id: '1', name: null }] }, {}, '/smart-search')).status, 400);
    assert.equal((await f.post({ imageBase64: 'not-an-image', mimeType: 'image/jpeg' }, {}, '/extract-invoice')).status, 400);
    const large = await fetch(f.url + '/api/ai/financial-insights', { method: 'POST', headers, body: JSON.stringify({ padding: 'x'.repeat(270 * 1024) }) });
    assert.equal(large.status, 413); assert.equal(f.calls(), 0);
  } finally { await f.close(); }
  const fail = await fixture({ createAiClient: () => ({ models: { generateContent: async () => { throw new Error('provider-private-key-patient-information'); } } } as any) });
  try { const response = await fail.post(); assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('provider-private')); }
  finally { await fail.close(); }
});

test('image payload accepts only bounded canonical JPEG/PNG/WEBP data with matching signatures and a valid tooth', () => {
  assert.deepEqual(validateAiPayload('/extract-invoice', { imageBase64: `data:image/jpeg;base64,${jpeg}` }), { imageBase64: jpeg, mimeType: 'image/jpeg' });
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString('base64');
  assert.equal(validateAiPayload('/endodontic-helper', { imageBase64: `data:image/png;base64,${png}`, toothNumber: '21' }).mimeType, 'image/png');
  for (const input of [{ imageBase64: jpeg, mimeType: 'image/png' }, { imageBase64: 'a'.repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 68) },
    { imageBase64: `data:image/svg+xml;base64,${jpeg}` }, { imageBase64: Buffer.from('<script/>').toString('base64') }]) assert.throws(() => validateAiPayload('/extract-invoice', input));
  assert.throws(() => validateAiPayload('/endodontic-helper', { imageBase64: jpeg, toothNumber: '68' }));
});

test('validated provider payloads omit extraneous patient identity and financial/credential metadata', () => {
  const payload = validateAiPayload('/smart-search', { query: 'x', patients: [{ id: '1', name: 'test', password: 'private', notes: 'note', labTotal: 999 }] });
  assert.equal(payload.patients[0].password, undefined); assert.equal(payload.patients[0].labTotal, undefined);
  const appointments = validateAiPayload('/schedule-assistant', { procedureType: 'test', date: '2026-10-06', existingAppointments: [{ date: '2026-10-06', time: '12:30', patientName: 'private', mobile: 'private' }] });
  assert.equal(appointments.existingAppointments[0].patientName, undefined);
  assert.throws(() => validateAiPayload('/schedule-assistant', { procedureType: 'test', date: '2026-02-30', existingAppointments: [] }));
});

test('authorized smart search includes every accepted patient, including files after the first 50', async () => {
  const patients = Array.from({ length: 1000 }, (_, index) => ({ id: String(index + 1), name: `Test Patient ${index + 1}` }));
  let submittedPatients: Array<{ id: string; name: string }> = [];
  const f = await fixture({ createAiClient: () => ({ models: { generateContent: async (request: any) => {
    const serializedPatients = request.contents.match(/قائمة المرضى: ([\s\S]*?)\n\nحدد/)?.[1];
    assert.ok(serializedPatients, 'the prompt must contain the accepted patient list');
    submittedPatients = JSON.parse(serializedPatients);
    return { text: JSON.stringify({ matchedIds: ['1000'], explanation: 'test' }) };
  } } } as any) });
  try {
    const response = await f.post({ query: 'Test Patient 1000', patients }, {}, '/smart-search');
    assert.equal(response.status, 200);
    assert.deepEqual(submittedPatients.map(patient => patient.id), patients.map(patient => patient.id));
    assert.deepEqual((await response.json()).matchedIds, ['1000']);
  } finally { await f.close(); }
});

test('production static server denies accidental server/source artifacts and unknown APIs instead of SPA fallback', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dental-server-test-'));
  const f = await fixture({ env: { NODE_ENV: 'production' } });
  try {
    await writeFile(path.join(dir, 'index.html'), '<main>test website</main>');
    await writeFile(path.join(dir, 'server.cjs'), 'server-secret');
    await writeFile(path.join(dir, 'server.cjs.map'), 'server-source-secret');
    await writeFile(path.join(dir, '.env'), 'private-secret');
    await mkdir(path.join(dir, 'assets')); await writeFile(path.join(dir, 'assets', 'app.js'), 'console.log("public")');
    mountProductionWebsite(f.app, dir);
    for (const uri of ['/server.cjs', '/server.cjs.map', '/server.ts', '/server%2ecjs', '/.env', '/%2eenv', '/api/unknown', '/api/ai/unknown']) {
      const response = await fetch(f.url + uri); assert.equal(response.status, 404); assert.ok(!(await response.text()).includes('secret'));
    }
    const response = await fetch(f.url); assert.equal(response.status, 200); assert.equal(await response.text(), '<main>test website</main>');
    assert.equal(response.headers.get('x-powered-by'), null); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
    assert.equal((await fetch(f.url + '/assets/app.js')).status, 200);
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
    assert.equal(scripts.start, 'node scripts/start-server.mjs');
    const build = readFileSync('scripts/build-server.mjs', 'utf8'); assert.ok(build.includes("outfile: 'build/server.cjs'")); assert.ok(build.includes('sourcemap: false'));
    assert.ok(readFileSync('scripts/start-server.mjs', 'utf8').includes("process.env.NODE_ENV = 'production'"));
    const serverSource = readFileSync('server.ts', 'utf8'); assert.ok(!serverSource.includes("from 'vite'")); assert.ok(serverSource.includes("await import('vite')"));
  } finally { await f.close(); await rm(dir, { recursive: true, force: true }); }
});
