import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudOperationIntentRepository, type CloudIntentAdapter } from './cloudOperationIntent';
import { CLOUD_CLINIC_SETTINGS_PATH, CLOUD_PROSTHETIC_ROUTING_PATH, CLOUD_CLINIC_LOGO_PATH,
  MAX_CLOUD_CLINIC_SETTINGS_BYTES, MAX_CLOUD_CLINIC_LOGO_BYTES, CloudClinicSettingsError,
  createCloudClinicSettingsRepository, parseCloudClinicSettingsData, parseCloudLabDefinitionData,
  parseCloudProstheticRoutingData, parseCloudClinicLogoData, parseCloudClinicSettingsRecord,
  parseCloudLabDefinition, parseCloudProstheticRouting, parseCloudClinicLogoRecord,
  prepareCloudClinicSettingsCommand, prepareCloudLabPageInput, cloudLabDefinitionPath,
  type CloudClinicSettingsAdapter, type CloudClinicSettingsCommand, type CloudClinicSettingsData,
  type CloudLabDefinitionData } from './cloudClinicSettingsRepository';

// Entirely fabricated transaction server; no patient data, Firebase SDK, IAM,
// browser account/settings or real owner credentials are touched.
const OWNER = 'synthetic-settings-owner', WHEN = '2026-10-12T00:00:00.000Z';
const id = (number: number) => `20000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const labId = (number: number) => `30000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const materialId = (number: number) => `40000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const serviceId = (number: number) => `50000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const op = (number: number) => `clinics/main/settingsOperations/${id(number)}`;
const intent = (number: number) => `clinics/main/operationIntents/${id(number)}`;
const digest = async (text: string) => createHash('sha256').update(text).digest('hex');
const code = (expected: CloudClinicSettingsError['code']) => (value: unknown) => value instanceof CloudClinicSettingsError && value.code === expected;
const sections = ['patients', 'contacts', 'appointments', 'lab', 'summary', 'settings'] as const;
function settings(): CloudClinicSettingsData {
  return {
    identity: { clinicName: 'عيادة اختبار مصطنعة', doctorName: '', phone: '', address: '', logoRecordId: null },
    theme: { primary: '#2563eb', secondary: '#1d4ed8', accent: '#f59e0b', background: '#f8fafc', fontFamily: "'Cairo', sans-serif", customFontUrl: null },
    content: { homeSubtitle: '', welcomeText: '',
      tiles: Object.fromEntries(sections.map(key => [key, { title: `قسم ${key}`, desc: '' }])) as CloudClinicSettingsData['content']['tiles'],
      tabs: { info: 'البيانات', chart: 'الأسنان', sessions: 'الجلسات', finance: 'الحساب', lab: 'المعمل' },
      navigationLabels: Object.fromEntries(['home', ...sections].map(key => [key, `قسم ${key}`])) as CloudClinicSettingsData['content']['navigationLabels'],
      mobile: { order: [...sections], size: 'comfortable', showLabels: true, visibleCount: 4, moreSections: ['settings'] },
      desktop: { order: [...sections].reverse(), size: 'large', showLabels: true },
      homeLayout: { sectionOrder: ['actions', 'metrics', 'schedule', 'followUp'], hiddenSections: [], density: 'compact', appointmentLimit: 6 } },
    medications: [{ medicationId: materialId(11), name: 'دواء تجريبي', category: '', defaultDosage: '', defaultDuration: '', active: true }],
    whatsapp: { senderNumber: '', autoConfirmOnAppt: false, autoRemind24h: false, autoPostOpOnAttended: false,
      templates: [{ templateId: materialId(12), key: 'newAppt', title: 'موعد تجريبي', text: 'أهلاً {patientName} 🌷\nموعدك {date}' }] },
  };
}
function lab(): CloudLabDefinitionData {
  return { name: 'معمل مصطنع', phone: '', address: '', notes: '', active: true, costs: [
    { materialId: materialId(1), name: 'زيركون تجريبي', category: 'fixed', unitLabel: 'تاج', billingBasis: 'per-unit', unitCostCents: 12_000, active: true },
    { materialId: materialId(2), name: 'طقم تجريبي', category: 'removable', unitLabel: 'طقم', billingBasis: 'whole-case', unitCostCents: null, active: true },
  ] };
}
const routing = () => ({ routes: [{ serviceId: serviceId(1), labId: labId(1), materialId: materialId(1) }] });
const png = () => ({ mimeType: 'image/png' as const, base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZNsAAAAASUVORK5CYII=', width: 1, height: 1 });
const envelope = (recordId: string, data: unknown, revision = 1) => ({ schemaVersion: 1, clinicId: 'main', recordId, revision, lastOperationId: id(99), data });
const command = (number = 1, revision = 0, overrides: Record<string, unknown> = {}): CloudClinicSettingsCommand => ({ target: 'clinicSettings', recordId: 'clinicSettings',
  operationId: id(number), expectedRevision: revision, createdAt: WHEN, data: settings(), ...overrides } as CloudClinicSettingsCommand);
function harness() {
  const docs = new Map<string, any>(), calls: string[] = [];
  let uid = OWNER, writes = 0, tail = Promise.resolve(), authCount = 0;
  const faults = { lostReply: false, retry: false, failAt: 0 };
  const hooks: { read?: (path: string) => void; auth?: (count: number) => Promise<void> | void; accepted?: () => void } = {};
  const adapter: CloudClinicSettingsAdapter & CloudIntentAdapter = {
    authorizeOwner: async () => { calls.push('auth'); await hooks.auth?.(++authCount); return uid; },
    readRecord: async path => { calls.push(`read:${path}`); hooks.read?.(path); return structuredClone(docs.get(path) ?? null); },
    listLabsPage: async (after, count) => [...docs].filter(([path]) => path.startsWith('clinics/main/labDefinitions/')
      && (!after || path.split('/').at(-1)! > after)).sort(([a], [b]) => a < b ? -1 : 1).slice(0, count)
      .map(([path, value]) => ({ id: path.split('/').at(-1), data: structuredClone(value) })),
    listHistoryPage: async (kind, actorUid, after, count) => [...docs].filter(([path, value]) => path.startsWith('clinics/main/operationIntents/')
      && value.kind === kind && value.actorUid === actorUid && (!after || value.operationId > after))
      .sort(([a], [b]) => a < b ? -1 : 1).slice(0, count).map(([path, value]) => ({ id: path.split('/').at(-1), data: structuredClone(value) })),
    runTransaction: async work => {
      const previous = tail; let release!: () => void; tail = new Promise<void>(accept => { release = accept; }); await previous;
      const attempt = async (publish: boolean) => {
        const staged = structuredClone(docs); let wrote = false, domain = false;
        const result = await work({
          get: async path => { assert.equal(wrote, false, 'every read precedes all writes'); calls.push(`get:${path}`); hooks.read?.(path); return structuredClone(staged.get(path) ?? null); },
          set: (path, value) => { wrote = true; calls.push(`set:${path}`); if (++writes === faults.failAt) throw new Error('PRIVATE_WRITE');
            domain ||= path.startsWith('clinics/main/settings/') || path.startsWith('clinics/main/labDefinitions/'); staged.set(path, structuredClone(value)); },
        });
        if (publish) { docs.clear(); for (const [path, value] of staged) docs.set(path, value); }
        if (publish && domain) { hooks.accepted?.(); if (faults.lostReply) { faults.lostReply = false; throw new Error('PRIVATE_LOST_REPLY'); } }
        return result;
      };
      try { if (faults.retry) { faults.retry = false; await attempt(false); } return await attempt(true); } finally { release(); }
    },
  };
  const repo = createCloudClinicSettingsRepository(adapter, { digest }), journal = createCloudOperationIntentRepository(adapter, { digest });
  const prepare = (value: CloudClinicSettingsCommand) => journal.prepare('settings', prepareCloudClinicSettingsCommand(value), value.createdAt);
  const seedRouting = () => docs.set(CLOUD_PROSTHETIC_ROUTING_PATH, envelope('prostheticRouting', { routes: [] }));
  const seedLab = (number = 1) => docs.set(cloudLabDefinitionPath(labId(number)), envelope(labId(number), lab()));
  const seedCatalog = () => docs.set('clinics/main/settings/serviceCatalog', envelope('serviceCatalog', { examinationCents: 10000,
    services: [{ serviceId: serviceId(1), name: 'تركيبة تجريبية', kind: 'prosthetic', priceCents: 30000, active: true }] }));
  return { docs, calls, adapter, repo, journal, prepare, seedRouting, seedLab, seedCatalog, faults, hooks,
    writes: () => writes, owner: (value: string) => { uid = value; }, client: () => createCloudClinicSettingsRepository(adapter, { digest }) };
}

test('settings construction is inert and all missing protected records remain unknown without defaults or seeding', async () => {
  const h = harness(); assert.deepEqual(h.calls, []);
  assert.equal(await h.repo.get(), null); assert.equal(await h.repo.getRouting(), null); assert.equal(await h.repo.getLab(labId(1)), null);
  assert.equal(await h.repo.getLogo(), null); assert.deepEqual(await h.repo.listLabsPage(), { records: [], nextAfterId: null });
  assert.equal(h.docs.size, 0); assert.equal(h.writes(), 0);
});
test('settings save couples one version, immutable receipt and committed durable intent without patient prices', async () => {
  const h = harness(), value = command(); await h.prepare(value); const before = h.writes();
  assert.deepEqual(await h.repo.commit(value), { status: 'committed', target: 'clinicSettings', recordId: 'clinicSettings', revision: 1 });
  assert.equal(h.writes() - before, 3); assert.deepEqual((await h.repo.get())?.data, settings());
  assert.equal(h.docs.get(intent(1)).status, 'committed'); assert.equal(h.docs.get(op(1)).resultRevision, 1);
  assert.doesNotMatch(JSON.stringify(h.docs.get(op(1))), /عيادة|medications|templates|unitCostCents/);
  assert.equal(h.docs.has('clinics/main/settings/serviceCatalog'), false);
});
test('independent mobile and desktop content order/size/labels round trip without inheritance or permission fields', () => {
  const value = parseCloudClinicSettingsData(settings()); assert.notDeepEqual(value.content.mobile.order, value.content.desktop.order);
  assert.equal(value.content.mobile.size, 'comfortable'); assert.equal(value.content.desktop.size, 'large');
  assert.deepEqual(value.content.mobile.moreSections, ['settings']); assert.equal('moreSections' in value.content.desktop, false);
});
test('lab create requires explicit routing bootstrap and preserves private per-material prices without patient charges', async () => {
  const h = harness(), value = command(1, 0, { target: 'lab', recordId: labId(1), data: lab() }); await h.prepare(value);
  await assert.rejects(h.repo.commit(value), code('invalid')); assert.equal(h.docs.has(cloudLabDefinitionPath(labId(1))), false);
  h.seedRouting(); await h.repo.commit(value); const saved = await h.repo.getLab(labId(1));
  assert.deepEqual(saved?.data, lab()); assert.equal(saved?.data.costs[0].billingBasis, 'per-unit');
  assert.equal(saved?.data.costs[1].billingBasis, 'whole-case'); assert.equal(saved?.data.costs[1].unitCostCents, null);
  assert.equal([...h.docs.keys()].some(path => /patient|clinical|cash|labAccounts/.test(path)), false);
});
test('routing resolves only explicit active prosthetic service and exact active lab material, never guesses a default', async () => {
  const h = harness(); h.seedCatalog(); h.seedLab(); const value = command(1, 0, { target: 'prostheticRouting', recordId: 'prostheticRouting', data: routing() });
  await h.prepare(value); await h.repo.commit(value); assert.deepEqual((await h.repo.getRouting())?.data, routing());
  assert.equal(h.calls.some(call => call === `get:${cloudLabDefinitionPath(labId(1))}`), true);
});
test('routing rejects missing/clinical/inactive service, missing/inactive lab and missing/inactive material before every write', async () => {
  for (const change of [
    (h: ReturnType<typeof harness>) => h.docs.delete('clinics/main/settings/serviceCatalog'),
    (h: ReturnType<typeof harness>) => h.docs.get('clinics/main/settings/serviceCatalog').data.services[0].kind = 'clinical',
    (h: ReturnType<typeof harness>) => h.docs.get('clinics/main/settings/serviceCatalog').data.services[0].active = false,
    (h: ReturnType<typeof harness>) => h.docs.get('clinics/main/settings/serviceCatalog').data.services = [],
    (h: ReturnType<typeof harness>) => h.docs.delete(cloudLabDefinitionPath(labId(1))),
    (h: ReturnType<typeof harness>) => h.docs.get(cloudLabDefinitionPath(labId(1))).data.active = false,
    (h: ReturnType<typeof harness>) => h.docs.get(cloudLabDefinitionPath(labId(1))).data.costs[0].active = false,
    (h: ReturnType<typeof harness>) => h.docs.get(cloudLabDefinitionPath(labId(1))).data.costs = [],
  ]) {
    const h = harness(); h.seedCatalog(); h.seedLab(); const value = command(1, 0, { target: 'prostheticRouting', recordId: 'prostheticRouting', data: routing() });
    await h.prepare(value); change(h); const before = structuredClone(h.docs); await assert.rejects(h.repo.commit(value)); assert.deepEqual(h.docs, before);
  }
});
test('empty routing is explicit valid configuration and can be created before catalogs/labs', async () => {
  const h = harness(), value = command(1, 0, { target: 'prostheticRouting', recordId: 'prostheticRouting', data: { routes: [] } });
  await h.prepare(value); await h.repo.commit(value); assert.deepEqual((await h.repo.getRouting())?.data, { routes: [] });
  assert.equal(h.calls.some(call => call.includes('serviceCatalog') || call.includes('labDefinitions')), false);
});
test('lab changes cannot deactivate a routed lab/material or remove a routed material but may explicitly change future cost', async () => {
  for (const change of [(value: CloudLabDefinitionData) => value.active = false,
    (value: CloudLabDefinitionData) => value.costs[0].active = false, (value: CloudLabDefinitionData) => value.costs.shift()]) {
    const h = harness(); h.seedLab(); h.docs.set(CLOUD_PROSTHETIC_ROUTING_PATH, envelope('prostheticRouting', routing()));
    const next = lab(); change(next); const value = command(1, 1, { target: 'lab', recordId: labId(1), data: next });
    await h.prepare(value); const before = structuredClone(h.docs); await assert.rejects(h.repo.commit(value), code('conflict')); assert.deepEqual(h.docs, before);
  }
  const h = harness(); h.seedLab(); h.docs.set(CLOUD_PROSTHETIC_ROUTING_PATH, envelope('prostheticRouting', routing()));
  const next = lab(); next.costs[0].unitCostCents = 14000; const value = command(1, 1, { target: 'lab', recordId: labId(1), data: next });
  await h.prepare(value); await h.repo.commit(value); assert.equal((await h.repo.getLab(labId(1)))?.data.costs[0].unitCostCents, 14000);
});
test('same-ID historical replay never reads or restores newer settings, logo, lab/routing or renamed materials', async () => {
  const h = harness(), first = command(); await h.prepare(first); await h.repo.commit(first);
  const nextData = settings(); nextData.identity.clinicName = 'اسم أحدث'; const next = command(2, 1, { data: nextData });
  await h.prepare(next); await h.repo.commit(next); const before = structuredClone(h.docs), writes = h.writes(), count = h.calls.length;
  assert.equal((await h.client().commit(first)).status, 'already-committed'); assert.equal(h.writes(), writes); assert.deepEqual(h.docs, before);
  assert.deepEqual(h.calls.slice(count).filter(call => call.startsWith('get:')).sort(), [`get:${intent(1)}`, `get:${op(1)}`].sort());
  assert.equal((await h.repo.get())?.data.identity.clinicName, 'اسم أحدث');
});
test('lost acknowledgement is recovered with the original command and historical receipt across a fresh client', async () => {
  const h = harness(), value = command(); await h.prepare(value); h.faults.lostReply = true;
  await assert.rejects(h.repo.commit(value), code('unavailable')); assert.equal(h.docs.get(CLOUD_CLINIC_SETTINGS_PATH).revision, 1);
  const history = await h.journal.listHistoryPage('settings'); assert.equal(history.records[0].status, 'committed');
  const before = structuredClone(h.docs); await h.client().commit(prepareCloudClinicSettingsCommand(history.records[0].command)); assert.deepEqual(h.docs, before);
});
test('missing or cancelled durable intent cannot write settings and cannot turn into a replacement operation', async () => {
  const h = harness(), value = command(); await assert.rejects(h.repo.commit(value), code('invalid')); assert.equal(h.docs.size, 0);
  await h.prepare(value); await h.journal.cancel(value.operationId); const before = structuredClone(h.docs);
  await assert.rejects(h.repo.commit(value), code('conflict')); assert.deepEqual(h.docs, before);
});
test('receipt and committed intent must coexist exactly, including target actor and whole-body fingerprint', async () => {
  for (const change of [(h: ReturnType<typeof harness>) => h.docs.delete(intent(1)), (h: ReturnType<typeof harness>) => h.docs.delete(op(1)),
    (h: ReturnType<typeof harness>) => h.docs.get(intent(1)).status = 'prepared',
    (h: ReturnType<typeof harness>) => h.docs.get(op(1)).target = 'lab',
    (h: ReturnType<typeof harness>) => h.docs.get(op(1)).extra = true,
    (h: ReturnType<typeof harness>) => h.docs.get(op(1)).requestHash = '0'.repeat(64),
    (h: ReturnType<typeof harness>) => h.docs.get(intent(1)).command.data.identity.clinicName = 'تلاعب']) {
    const h = harness(), value = command(); await h.prepare(value); await h.repo.commit(value); change(h);
    const before = structuredClone(h.docs); await assert.rejects(h.repo.commit(value)); assert.deepEqual(h.docs, before);
  }
});
test('same operation ID cannot change target, data, actor, time or expected revision', async () => {
  const h = harness(), value = command(); await h.prepare(value); await h.repo.commit(value); const before = structuredClone(h.docs);
  const nextData = settings(); nextData.identity.clinicName = 'اسم آخر';
  for (const next of [command(1, 1), command(1, 0, { data: nextData }), command(1, 0, { createdAt: '2026-10-12T00:00:00.001Z' }),
    command(1, 0, { target: 'prostheticRouting', recordId: 'prostheticRouting', data: { routes: [] } })]) await assert.rejects(h.repo.commit(next), code('conflict'));
  h.owner('different-synthetic-owner'); await assert.rejects(h.repo.commit(value), code('conflict')); assert.deepEqual(h.docs, before);
});
test('concurrent settings clients retain CAS and never rebase or overwrite each other', async () => {
  const h = harness(), a = command(), b = command(2); await h.prepare(a); await h.prepare(b);
  const results = await Promise.allSettled([h.repo.commit(a), h.client().commit(b)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && code('conflict')(result.reason)).length, 1);
  assert.equal(h.docs.get(CLOUD_CLINIC_SETTINGS_PATH).revision, 1);
});
test('transaction retries produce one revision while failure at any companion write leaves no partial state', async () => {
  const h = harness(), value = command(); await h.prepare(value); h.faults.retry = true; await h.repo.commit(value);
  assert.equal(h.docs.get(CLOUD_CLINIC_SETTINGS_PATH).revision, 1); assert.equal(h.docs.size, 3);
  for (const index of [1, 2, 3]) {
    const x = harness(); await x.prepare(value); const before = structuredClone(x.docs); x.faults.failAt = x.writes() + index;
    await assert.rejects(x.repo.commit(value), code('unavailable')); assert.deepEqual(x.docs, before);
  }
});
test('identity loss before write rejects it; after server acceptance hides acknowledgement but never claims rollback', async () => {
  const h = harness(), value = command(); await h.prepare(value); const before = structuredClone(h.docs);
  h.hooks.read = path => { if (path === CLOUD_CLINIC_SETTINGS_PATH) h.owner('different-owner'); };
  await assert.rejects(h.repo.commit(value), code('unavailable')); assert.deepEqual(h.docs, before);
  const x = harness(); await x.prepare(value); x.hooks.accepted = () => x.owner('different-owner');
  await assert.rejects(x.repo.commit(value), code('unavailable')); assert.equal(x.docs.get(CLOUD_CLINIC_SETTINGS_PATH).revision, 1);
});
test('command data snapshots before first authorization wait and all parsed nested outputs are detached', async () => {
  const h = harness(), value = command(), saved = structuredClone(value); await h.prepare(saved);
  let release!: () => void, started!: () => void; const gate = new Promise<void>(accept => { release = accept; });
  const begin = new Promise<void>(accept => { started = accept; }); let first = true;
  h.hooks.auth = async () => { if (first) { first = false; started(); await gate; } };
  const pending = h.repo.commit(value); await begin; (value.data as CloudClinicSettingsData).identity.clinicName = 'تعديل متأخر'; value.operationId = id(88);
  release(); await pending; assert.deepEqual((await h.repo.get())?.data, saved.data); assert.equal(h.docs.has(op(88)), false);
  const input = settings(), parsed = parseCloudClinicSettingsData(input); input.content.mobile.order.reverse(); input.medications[0].name = 'تعديل';
  assert.notDeepEqual(input.content.mobile.order, parsed.content.mobile.order); assert.equal(parsed.medications[0].name, 'دواء تجريبي');
});
test('all owner reads reauthorize and missing optional adapters never fall back to browser/default settings', async () => {
  const h = harness(); delete h.adapter.readRecord; delete h.adapter.listLabsPage;
  for (const action of [() => h.repo.get(), () => h.repo.getRouting(), () => h.repo.getLab(labId(1)), () => h.repo.getLogo(), () => h.repo.listLabsPage()])
    await assert.rejects(action(), code('unavailable'));
  const x = harness(); x.hooks.read = () => x.owner('different-owner'); await assert.rejects(x.repo.get(), code('unavailable'));
});
test('lab page snapshots UUID ordered dense records with bounded cursors and exact envelopes', async () => {
  const h = harness(); for (const number of [1, 2, 3]) h.seedLab(number);
  const first = await h.repo.listLabsPage({ limit: 2 }); assert.deepEqual(first.records.map(row => row.recordId), [labId(1), labId(2)]);
  assert.equal(first.nextAfterId, labId(2)); const second = await h.repo.listLabsPage({ afterId: first.nextAfterId, limit: 2 });
  assert.deepEqual(second.records.map(row => row.recordId), [labId(3)]); assert.equal(second.nextAfterId, null);
  for (const raw of [[{ id: labId(2), data: envelope(labId(2), lab()) }, { id: labId(1), data: envelope(labId(1), lab()) }],
    [{ id: labId(1), data: envelope(labId(2), lab()) }], new Array(1)]) {
    h.adapter.listLabsPage = async () => raw; await assert.rejects(h.repo.listLabsPage(), code('invalid'));
  }
});
test('invalid lab pages fail before authorization and never silently ignore undeclared filters or numbers', async () => {
  const h = harness(); for (const value of [null, [], { limit: 0 }, { limit: 51 }, { limit: '25' }, { afterId: 'bad' }, { name: 'x' }])
    await assert.rejects(h.repo.listLabsPage(value), code('invalid'));
  assert.deepEqual(h.calls, []); assert.deepEqual(prepareCloudLabPageInput(), { afterId: null, limit: 25 });
});
test('logo is separate on-demand raster data and cannot be referenced before save or cleared while referenced', async () => {
  const h = harness(), next = settings(); next.identity.logoRecordId = 'clinicLogo'; const main = command(2, 0, { data: next });
  await h.prepare(main); await assert.rejects(h.repo.commit(main), code('invalid'));
  const image = command(1, 0, { target: 'clinicLogo', recordId: 'clinicLogo', data: png() }); await h.prepare(image); await h.repo.commit(image); await h.repo.commit(main);
  const count = h.calls.length; await h.repo.get(); assert.equal(h.calls.slice(count).some(call => call.includes('clinicLogo')), false);
  assert.deepEqual((await h.repo.getLogo())?.data, png());
  const clear = command(3, 1, { target: 'clinicLogo', recordId: 'clinicLogo', data: null }); await h.prepare(clear);
  const before = structuredClone(h.docs); await assert.rejects(h.repo.commit(clear), code('conflict')); assert.deepEqual(h.docs, before);
  const unlink = command(4, 1); await h.prepare(unlink); await h.repo.commit(unlink); await h.repo.commit(clear); assert.equal((await h.repo.getLogo())?.data, null);
});
test('logo rejects non-raster/remote bytes, wrong geometry, noncanonical base64, oversized binary and SVG content', () => {
  assert.deepEqual(parseCloudClinicLogoData(png()), png()); assert.equal(parseCloudClinicLogoData(null), null);
  assert.equal(MAX_CLOUD_CLINIC_LOGO_BYTES, 48 * 1024);
  for (const changes of [{ mimeType: 'image/svg+xml' }, { base64: btoa('<svg/>') }, { base64: `data:image/png;base64,${png().base64}` },
    { base64: png().base64 + '\n' }, { base64: btoa('x'.repeat(MAX_CLOUD_CLINIC_LOGO_BYTES + 1)) }, { width: 2 }, { height: 0 },
    { width: 2049 }, { width: 2048, height: 2048 }, { extra: true }]) assert.throws(() => parseCloudClinicLogoData({ ...png(), ...changes }), code('invalid'));
});
test('clinic setting keys never carry accounts, credentials, provider endpoints, local sessions, exam or service prices', () => {
  for (const key of ['users', 'currentUser', 'session', 'apiKey', 'accessToken', 'examinationCents', 'clinicalPrices', 'crownPrices', 'labs'])
    assert.throws(() => parseCloudClinicSettingsData({ ...settings(), [key]: 'PRIVATE' }), code('invalid'));
  for (const key of ['apiKey', 'webhookUrl', 'providerToken', 'campaignConsent', 'isConnected']) {
    const value = settings(); (value.whatsapp as any)[key] = 'PRIVATE'; assert.throws(() => parseCloudClinicSettingsData(value), code('invalid'));
  }
});
test('WhatsApp preferences do not require or activate a provider and templates preserve explicit content and stable IDs', () => {
  const input = settings(); input.whatsapp.autoRemind24h = true;
  const result = parseCloudClinicSettingsData(input); assert.equal(result.whatsapp.autoRemind24h, true); assert.equal('apiKey' in result.whatsapp, false);
  input.whatsapp.templates.push({ ...input.whatsapp.templates[0], templateId: materialId(14) }); assert.throws(() => parseCloudClinicSettingsData(input), code('invalid'));
  input.whatsapp.templates[1].key = 'custom'; assert.equal(parseCloudClinicSettingsData(input).whatsapp.templates.length, 2);
});
test('exact settings reject prototypes/accessors/symbols, sparse arrays and controls without running getters', () => {
  let executed = 0;
  const accessor = Object.defineProperty(settings(), 'identity', { enumerable: true, get() { executed++; return settings().identity; } });
  const nested = settings(); Object.defineProperty(nested.medications, '0', { enumerable: true, get() { executed++; return settings().medications[0]; } });
  for (const value of [accessor, nested, Object.assign(Object.create({}), settings()), { ...settings(), [Symbol('hidden')]: true },
    new Proxy(settings(), { ownKeys() { throw new Error('PRIVATE_PROXY'); } }), { ...settings(), medications: new Array(1) }])
    assert.throws(() => parseCloudClinicSettingsData(value), code('invalid'));
  assert.equal(executed, 0);
  for (const value of [' عيادة', 'عيادة ', 'عيادة\u202e', '\ud800', 'عيادة\nاختبار']) {
    const input = settings(); input.identity.clinicName = value; assert.throws(() => parseCloudClinicSettingsData(input), code('invalid'));
  }
});
test('theme accepts only explicit opaque colors safe font-family and exact Google Fonts stylesheet URLs', () => {
  const valid = settings(); valid.theme.customFontUrl = 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap';
  assert.equal(parseCloudClinicSettingsData(valid).theme.customFontUrl, valid.theme.customFontUrl);
  for (const changes of [{ primary: '#ABCDEF' }, { primary: '#abcdef\n' }, { primary: 'red' }, { fontFamily: 'url(javascript:alert(1))' }, { customFontUrl: '' },
    { customFontUrl: 'https://evil.invalid/css2?family=Cairo' }, { customFontUrl: 'https://user:pass@fonts.googleapis.com/css2?family=Cairo' },
    { customFontUrl: 'https://fonts.googleapis.com/css2?family=Cairo#token' }, { customFontUrl: 'https://fonts.googleapis.com/private?family=Cairo' }]) {
    const value = settings(); Object.assign(value.theme, changes); assert.throws(() => parseCloudClinicSettingsData(value), code('invalid'));
  }
});
test('clinic/lab/sender phones require exact canonical digits and reject trailing controls rather than normalize them', () => {
  for (const number of ['201234567890\n', '+201234567890', ' 201234567890', '٠١٢٣٤٥٦٧٨٩', '001234567890', '1234567', '1234567890123456']) {
    const clinic = settings(); clinic.identity.phone = number; assert.throws(() => parseCloudClinicSettingsData(clinic), code('invalid'));
    const wa = settings(); wa.whatsapp.senderNumber = number; assert.throws(() => parseCloudClinicSettingsData(wa), code('invalid'));
    const laboratory = lab(); laboratory.phone = number; assert.throws(() => parseCloudLabDefinitionData(laboratory), code('invalid'));
  }
});
test('content requires complete separate mobile/web order and literal booleans with no duplicate/home/unknown More keys', () => {
  for (const modify of [(value: CloudClinicSettingsData) => value.content.mobile.order.pop(),
    (value: CloudClinicSettingsData) => value.content.mobile.order[1] = value.content.mobile.order[0],
    (value: CloudClinicSettingsData) => (value.content.mobile.moreSections as string[]).push('home'),
    (value: CloudClinicSettingsData) => (value.content.desktop as any).moreSections = [],
    (value: CloudClinicSettingsData) => (value.content.mobile as any).showLabels = 1,
    (value: CloudClinicSettingsData) => (value.content.mobile as any).visibleCount = 5,
    (value: CloudClinicSettingsData) => value.content.homeLayout.sectionOrder.pop(),
    (value: CloudClinicSettingsData) => (value.content.navigationLabels as any).extra = 'x']) {
    const value = settings(); modify(value); assert.throws(() => parseCloudClinicSettingsData(value), code('invalid'));
  }
});
test('medication/material identifiers names and exact scalar field bounds are strict without inferred medical dose', () => {
  const blank = settings(); blank.medications[0].defaultDosage = ''; assert.equal(parseCloudClinicSettingsData(blank).medications[0].defaultDosage, '');
  for (const changes of [{ medicationId: 'bad' }, { active: 'true' }, { defaultDosage: 'x'.repeat(501) }, { extra: true }, { name: 'prototype' }]) {
    const value = settings(); Object.assign(value.medications[0], changes); assert.throws(() => parseCloudClinicSettingsData(value), code('invalid'));
  }
  const value = settings(); value.medications.push({ ...value.medications[0], medicationId: materialId(99), name: 'دَواء  تَجريبي' });
  assert.throws(() => parseCloudClinicSettingsData(value), code('invalid'));
});
test('per-lab money accepts integer piastres null unknown and explicit zero, rejecting floats/negative/string/private patient prices', () => {
  for (const amount of [null, 0, 1, 1_000_000_000_000]) { const input = lab(); input.costs[0].unitCostCents = amount; assert.equal(parseCloudLabDefinitionData(input).costs[0].unitCostCents, amount); }
  for (const amount of [-0, -1, 0.5, NaN, Infinity, '12000', undefined, 1_000_000_000_001]) {
    const input = lab(); (input.costs[0] as any).unitCostCents = amount; assert.throws(() => parseCloudLabDefinitionData(input), code('invalid'));
  }
  for (const changes of [{ patientPriceCents: 1 }, { billingBasis: 'crown' }, { category: 'guess' }, { materialId: 'bad' }, { active: 1 }]) {
    const input = lab(); Object.assign(input.costs[0], changes); assert.throws(() => parseCloudLabDefinitionData(input), code('invalid'));
  }
});
test('routing UUID fields, duplicate services, row and distinct-lab budgets are explicit and never truncated', () => {
  assert.equal(parseCloudProstheticRoutingData({ routes: [] }).routes.length, 0);
  for (const value of [{ routes: [...routing().routes, ...routing().routes] }, { routes: [{ ...routing().routes[0], materialId: 'bad' }] },
    { routes: [{ ...routing().routes[0], costCents: 1 }] }, { routes: new Array(1) },
    { routes: Array.from({ length: 7 }, (_, index) => ({ serviceId: serviceId(index), labId: labId(index), materialId: materialId(index) })) },
    { routes: Array.from({ length: 101 }, (_, index) => ({ serviceId: serviceId(index), labId: labId(1), materialId: materialId(index) })) }])
    assert.throws(() => parseCloudProstheticRoutingData(value), code('invalid'));
});
test('UTF-8 overall settings budget rejects heavy Unicode without truncating catalogs or messages', () => {
  assert.equal(MAX_CLOUD_CLINIC_SETTINGS_BYTES, 96 * 1024);
  const value = settings(); value.whatsapp.templates = Array.from({ length: 60 }, (_, index) => ({ templateId: materialId(index + 100), key: 'custom', title: `قالب ${index}`, text: '😀'.repeat(4000) }));
  assert.ok(new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_CLOUD_CLINIC_SETTINGS_BYTES);
  assert.throws(() => parseCloudClinicSettingsData(value), code('invalid')); assert.equal(value.whatsapp.templates.length, 60);
});
test('command target IDs exact fields revisions and timestamps reject spoofing/exhaustion before any authorization', async () => {
  const h = harness(); for (const changes of [{ target: 'serviceCatalog' }, { recordId: 'other' }, { target: 'lab', recordId: 'bad' },
    { operationId: id(1) + '\n' }, { expectedRevision: -0 }, { expectedRevision: 2_000_000_000 }, { expectedRevision: '0' },
    { createdAt: '2026-02-30T00:00:00.000Z' }, { createdAt: '2026-10-12' }, { extra: true }])
    await assert.rejects(h.repo.commit({ ...command(), ...changes }), code('invalid'));
  assert.deepEqual(h.calls, []);
});
test('record parsers strictly bind schema clinic immutable ID last operation and bounded revision', () => {
  const value = envelope('clinicSettings', settings()); assert.equal(parseCloudClinicSettingsRecord(value).revision, 1);
  for (const change of [{ schemaVersion: 2 }, { clinicId: 'other' }, { recordId: 'other' }, { lastOperationId: 'bad' }, { revision: 0 }, { extra: true }])
    assert.throws(() => parseCloudClinicSettingsRecord({ ...value, ...change }), code('invalid'));
  assert.equal(parseCloudLabDefinition(envelope(labId(1), lab()), labId(1)).recordId, labId(1));
  assert.throws(() => parseCloudLabDefinition(envelope(labId(1), lab()), labId(2)), code('invalid'));
  assert.equal(parseCloudProstheticRouting(envelope('prostheticRouting', routing())).recordId, 'prostheticRouting');
  assert.equal(parseCloudClinicLogoRecord(envelope('clinicLogo', png())).data?.width, 1);
});
test('corrupt current records cannot be reset while unknown expected revision is never silently adopted', async () => {
  for (const raw of [undefined, { revision: 1 }, { ...envelope('clinicSettings', settings()), clinicId: 'other' }]) {
    const h = harness(); h.docs.set(CLOUD_CLINIC_SETTINGS_PATH, raw); const value = command(1, 1); await h.prepare(value);
    const before = structuredClone(h.docs); await assert.rejects(h.repo.commit(value)); assert.deepEqual(h.docs, before);
  }
  const h = harness(), value = command(1, 1); await h.prepare(value); await assert.rejects(h.repo.commit(value), code('conflict'));
});
test('provider/digest and malicious proxy errors expose fixed settings text only', async () => {
  const h = harness(); h.adapter.authorizeOwner = async () => { throw new Error('PRIVATE_TOKEN'); };
  await assert.rejects(h.repo.get(), value => code('unavailable')(value) && !String(value).includes('PRIVATE'));
  const x = harness(), bad = createCloudClinicSettingsRepository(x.adapter, { digest: async () => 'PRIVATE_BAD_HASH' });
  await assert.rejects(bad.commit(command()), code('invalid')); assert.equal(x.docs.size, 0);
});
test('malformed adapter acknowledgements never report a successful settings mutation', async () => {
  for (const raw of [null, { status: 'committed', target: 'lab', recordId: 'clinicSettings', revision: 1 },
    { status: 'committed', target: 'clinicSettings', recordId: 'clinicSettings', revision: 2 },
    { status: 'committed', target: 'clinicSettings', recordId: 'clinicSettings', revision: 1, token: 'PRIVATE' }]) {
    const h = harness(); h.adapter.runTransaction = async () => raw as any; await assert.rejects(h.repo.commit(command()), code('invalid')); assert.equal(h.docs.size, 0);
  }
});
