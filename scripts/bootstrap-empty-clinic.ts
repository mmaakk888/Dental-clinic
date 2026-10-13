/** Trusted operator tool, NOT a public endpoint or application capability.
 * Invoke only after R1–R4 acceptance with the existing Firebase CLI IAM session:
 * pnpm exec tsx scripts/bootstrap-empty-clinic.ts --apply --project=... 
 *   --cli-root=<installed firebase-tools> --owner-uid=<verified UID>
 *   --operation-id=<retained UUID> --routing-operation-id=<different UUID>
 *   --settings-operation-id=<third distinct retained UUID>
 *   --created-at=<retained ISO timestamp>
 * Keep all three IDs/time for an exact retry after an uncertain reply. The tool
 * never generates a replacement, uploads browser data or logs owner details.
 * --inspect verifies infrastructure only; it does NOT close release gates.
 * REST transaction/query/create preconditions:
 * https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/runQuery
 * https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOUD_PROJECT_ID } from '../src/utils/cloudIdentity';
import { CLOUD_BOOTSTRAP_EMPTY_COLLECTIONS, createCloudEmptyClinicBootstrap,
  type CloudBootstrapAdapter, type CloudBootstrapAuthority } from '../src/utils/cloudEmptyClinicBootstrap';

const quiet = { skipLog: { body: true, response: true } };
function encode(value: unknown): object {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isSafeInteger(value)) return { integerValue: String(value) };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
  }
  throw new Error('Unsupported initial metadata value.');
}
function decode(value: any, depth = 0): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || depth > 12) throw new Error();
  if (Object.hasOwn(value, 'nullValue')) return null;
  if (typeof value.stringValue === 'string') return value.stringValue;
  if (typeof value.booleanValue === 'boolean') return value.booleanValue;
  if (typeof value.integerValue === 'string' && /^-?\d+$/.test(value.integerValue)
    && Number.isSafeInteger(Number(value.integerValue))) return Number(value.integerValue);
  if (value.arrayValue && typeof value.arrayValue === 'object') {
    const items = value.arrayValue.values ?? [];
    if (!Array.isArray(items) || items.length > 2048) throw new Error();
    return items.map(item => decode(item, depth + 1));
  }
  if (value.mapValue && typeof value.mapValue === 'object') return decodeFields(value.mapValue.fields ?? {}, depth + 1);
  throw new Error('Unsupported stored metadata type.');
}
function decodeFields(fields: any, depth = 0): Record<string, unknown> {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length > 256) throw new Error();
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error();
    result[key] = decode(value, depth);
  }
  return result;
}
function argumentsOf(argv: string[]) {
  const allowed = ['project', 'cli-root', 'owner-uid', 'operation-id', 'routing-operation-id', 'settings-operation-id', 'created-at'];
  const input: Record<string, string> = {}; let mode: 'apply' | 'inspect' | null = null;
  for (const arg of argv) {
    if (arg === '--apply' || arg === '--inspect') { if (mode) throw new Error(); mode = arg === '--apply' ? 'apply' : 'inspect'; continue; }
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match || !allowed.includes(match[1]) || Object.hasOwn(input, match[1])) throw new Error();
    input[match[1]] = match[2];
  }
  if (!mode || input.project !== CLOUD_PROJECT_ID || !input['cli-root'] || !path.isAbsolute(input['cli-root'])
    || !input['owner-uid'] || !/^[A-Za-z0-9_-]{1,128}$/.test(input['owner-uid'])
    || mode === 'apply' && (!input['operation-id'] || !input['routing-operation-id'] || !input['settings-operation-id'] || !input['created-at'])) throw new Error();
  return { mode, input };
}

export async function runTrustedEmptyClinicBootstrap(argv: string[]) {
  const { mode, input } = argumentsOf(argv), require = createRequire(import.meta.url), cliRoot = input['cli-root'];
  const { Command } = require(path.join(cliRoot, 'lib/command.js'));
  const { requireAuth } = require(path.join(cliRoot, 'lib/requireAuth.js'));
  const { Client } = require(path.join(cliRoot, 'lib/apiv2.js'));
  const { FirestoreApi } = require(path.join(cliRoot, 'lib/firestore/api.js'));
  const { findUser } = require(path.join(cliRoot, 'lib/gcp/auth.js'));
  const rules = require(path.join(cliRoot, 'lib/gcp/rules.js'));
  const project = CLOUD_PROJECT_ID, ownerUid = input['owner-uid'];
  const options = { project, nonInteractive: true };
  await new Command('clinic:bootstrap-empty').prepare(options);
  await requireAuth(options);
  const client = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
  const database = `/projects/${project}/databases/(default)`, documents = `${database}/documents`;
  const expectedRules = readFileSync(new URL('../firestore.membership.rules', import.meta.url), 'utf8');
  const authorizeBootstrap = async (): Promise<CloudBootstrapAuthority> => {
    const [billing, store, user, releases] = await Promise.all([
      new Client({ urlPrefix: 'https://cloudbilling.googleapis.com', apiVersion: 'v1' }).get(`/projects/${project}/billingInfo`, quiet),
      new FirestoreApi().getDatabase(project, '(default)'), findUser(project, undefined, undefined, ownerUid), rules.listAllReleases(project),
    ]);
    const claims = JSON.parse(user?.customAttributes || '{}');
    if (billing.body.billingEnabled !== false || billing.body.billingAccountName || store.locationId !== 'europe-west1'
      || store.databaseEdition !== 'STANDARD' || store.freeTier !== true || store.deleteProtectionState !== 'DELETE_PROTECTION_ENABLED'
      || user.uid !== ownerUid || user.disabled === true || user.emailVerified !== true
      || claims.dentalClinicId !== 'main' || claims.dentalClinicRole !== 'owner') throw new Error();
    const release = releases.find(entry => entry.name === `projects/${project}/releases/cloud.firestore`);
    if (!release) throw new Error();
    const source = await rules.getRulesetContent(release.rulesetName);
    if (source.length !== 1 || source[0].content !== expectedRules) throw new Error();
    return { projectId: project, databaseId: '(default)', location: 'europe-west1', billingEnabled: false,
      membershipOnlyRules: true, ownerUid, ownerActive: true, ownerEmailVerified: true, ownerClaimsVerified: true };
  };
  if (mode === 'inspect') {
    await authorizeBootstrap();
    return { status: 'infrastructure-verified-only', project, writes: 0, releaseAccepted: false };
  }
  const checkedPath = (target: string) => {
    if (target === `clinics/main/members/${ownerUid}`) return `${documents}/${target}`;
    const parts = target.split('/');
    if (parts.length !== 4 || parts[0] !== 'clinics' || parts[1] !== 'main'
      || !CLOUD_BOOTSTRAP_EMPTY_COLLECTIONS.includes(parts[2] as any) || !/^[A-Za-z0-9-]{1,128}$/.test(parts[3])) throw new Error();
    return `${documents}/${target}`;
  };
  const adapter: CloudBootstrapAdapter = {
    authorizeBootstrap,
    runTransaction: async work => {
      const begun = await client.post(`${documents}:beginTransaction`, { options: { readWrite: {} } }, quiet);
      const transaction = begun.body.transaction;
      if (typeof transaction !== 'string' || !transaction || transaction.length > 2048) throw new Error();
      const writes: object[] = []; let staged = false;
      try {
        const result = await work({
          get: async target => {
            if (staged) throw new Error();
            let response;
            try { response = await client.get(checkedPath(target), { ...quiet, queryParams: { transaction } }); }
            catch (error: any) { if ((error.status ?? error.context?.response?.statusCode) === 404) return null; throw new Error(); }
            if (!response.body.fields) throw new Error();
            return decodeFields(response.body.fields);
          },
          listFirst: async target => {
            if (staged || !target.startsWith('clinics/main/') || target.split('/').length !== 3) throw new Error();
            const collectionId = target.split('/')[2];
            if (!CLOUD_BOOTSTRAP_EMPTY_COLLECTIONS.includes(collectionId as any)) throw new Error();
            const response = await client.post(`${documents}/clinics/main:runQuery`,
              { structuredQuery: { from: [{ collectionId }], limit: 1 }, transaction }, quiet);
            if (!Array.isArray(response.body) || response.body.length > 2) throw new Error();
            const found = response.body.filter(item => item.document);
            if (found.length > 1 || found.some(item => typeof item.document.name !== 'string'
              || !item.document.name.startsWith(`projects/${project}/databases/(default)/documents/${target}/`))) throw new Error();
            return found.map(() => ({ present: true }));
          },
          create: (target, value) => {
            staged = true;
            if (writes.length >= 11 || target.includes('/members/')) throw new Error();
            const encoded = encode(value) as { mapValue: { fields: object } };
            writes.push({ update: { name: checkedPath(target).slice(1), fields: encoded.mapValue.fields }, currentDocument: { exists: false } });
          },
        });
        await client.post(`${documents}:commit`, { transaction, writes }, quiet);
        return result;
      } catch {
        // Rollback ends the read transaction, not an already-accepted commit.
        // The caller retains the original IDs and confirms by exact replay.
        await client.post(`${documents}:rollback`, { transaction }, quiet).catch(() => undefined);
        throw new Error('Trusted initialization reply could not be confirmed.');
      }
    },
  };
  const result = await createCloudEmptyClinicBootstrap(adapter).initialize({ operationId: input['operation-id'],
    routingOperationId: input['routing-operation-id'], settingsOperationId: input['settings-operation-id'], createdAt: input['created-at'] });
  return { ...result, project, examinationEGP: 100, browserDataMigrated: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runTrustedEmptyClinicBootstrap(process.argv.slice(2)).then(result => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch(() => {
      process.stderr.write('Trusted empty-clinic setup stopped. No existing data was overwritten; keep the original operation IDs/time for a retry.\n');
      process.exitCode = 1;
    });
}
