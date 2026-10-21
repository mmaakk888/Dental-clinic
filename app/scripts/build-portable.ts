import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'vite';
import {createZip, listFiles} from './portable-zip';
import {
  DEFAULT_THEME, DEFAULT_UI_LABELS, DEFAULT_TILE_ORDER, DEFAULT_WHATSAPP_SETTINGS,
} from '../src/data/initialData';

// A release is immutable. Never overwrite a package the owner may have deployed.
// Prepare beside a running preview; activate only after the complete build passes.
const staging = process.argv[2] === '--staging';
if(process.argv.length > (staging ? 3 : 2)) throw Error('Usage: tsx scripts/build-portable.ts [--staging]');
const target = path.resolve(staging ? 'build/portable-next-release' : 'build/portable-release');
const artifacts = path.resolve(staging ? 'build/portable-next-artifacts' : 'build/portable-artifacts');
if (fs.existsSync(target) || fs.existsSync(artifacts)) {
  throw Error('Frozen release already exists. Rename build/portable-release AND build/portable-artifacts before preparing another release.');
}
for (const file of ['INSTALL.ar.md', 'DESIGN-REVIEW.ar.md', 'VERIFICATION.ar.md','BACKUP.ar.md','UPDATE.ar.md','UNFILED-VISITS.ar.md','WORKFLOW.ar.md','RELEASE-REVIEW.ar.md']) {
  if (!fs.existsSync(path.join('portable', file))) throw Error('Missing release document: ' + file);
}
await build({configFile: path.resolve('vite.portable.config.ts')});
fs.mkdirSync(target, {recursive: true});
const publicDir = path.join(target, 'htdocs');
const privateDir = path.join(target, 'sql-and-tools');
fs.cpSync('build/portable-public', publicDir, {recursive: true});
fs.cpSync('portable/api', path.join(publicDir, 'api'), {recursive: true});
fs.mkdirSync(path.join(privateDir, 'clinic-private'), {recursive: true});
for (const file of ['config.example.php', '.htaccess']) {
  fs.copyFileSync(path.join('portable/private', file), path.join(privateDir, 'clinic-private', file));
}
// Private operational tools only; no legacy data migration exporters.
fs.cpSync('portable/tools',path.join(privateDir,'portable/tools'),{recursive:true});
fs.copyFileSync('portable/schema.sql', path.join(privateDir, 'schema.sql'));
for (const file of ['INSTALL.ar.md', 'DESIGN-REVIEW.ar.md', 'VERIFICATION.ar.md','BACKUP.ar.md','UPDATE.ar.md','UNFILED-VISITS.ar.md','WORKFLOW.ar.md','RELEASE-REVIEW.ar.md']) {
  fs.copyFileSync(path.join('portable', file), path.join(privateDir, file));
}
const defaults = {
  clinicName: 'عيادة الأسنان', clinicLogo: null, theme: DEFAULT_THEME,
  content: {labels: DEFAULT_UI_LABELS, tileOrder: DEFAULT_TILE_ORDER},
  serviceCatalog: {serviceTypes: [], clinicalPrices: {}, crownPrices: {}, examinationFee: 100},
  prostheticRouting: {defaultLabs: {}, overrides: []},
  whatsappSettings: {...DEFAULT_WHATSAPP_SETTINGS, senderNumber: '', apiKey: '', webhookUrl: '', autoConfirmOnAppt: false, autoRemind24h: false, autoPostOpOnAttended: false},
  drugCatalog: [], prescriptionHeader: {doctorName:'',phone:'',address:''},
};
fs.writeFileSync(path.join(privateDir, 'clinic-private/defaults.json'), JSON.stringify(defaults, null, 2));
const builtAt = new Date().toISOString();
const versionSource=fs.readFileSync('portable/api/version.php','utf8');
const version=versionSource.match(/SYSTEM_VERSION='([^']+)'/)?.[1];
if(!version)throw Error('Missing canonical PHP system version.');
fs.writeFileSync(path.join(publicDir, 'release.json'), JSON.stringify({version, schemaVersion: 1, builtAt}, null, 2));
const manifest = listFiles(publicDir).map(file => ({
  path: path.relative(publicDir, file).replaceAll('\\', '/'),
  bytes: fs.statSync(file).size,
  sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
}));
for (const item of manifest) {
  if (/\.(?:sql|zip|log|env|db|sqlite|map|clinicbackup)$/i.test(item.path) || /(?:^|\/)(?:config\.php|defaults\.json|clinic-decryption-key-[^/]+\.json|node_modules|tools|migration-private|\.clinic-local)(?:\/|$)/.test(item.path)) {
    throw Error('Private/unwanted file in htdocs: ' + item.path);
  }
}
fs.writeFileSync(path.join(target, 'public-manifest.json'), JSON.stringify({builtAt, files: manifest}, null, 2));
fs.mkdirSync(artifacts);
createZip(path.join(artifacts, 'clinic-htdocs.zip'), publicDir, listFiles(publicDir));
createZip(path.join(artifacts, 'clinic-sql-and-tools.zip'), privateDir, listFiles(privateDir));

// Include the CURRENT working source, not an older Git commit. Use an allowlist
// and reject private directories/files even if they become untracked later.
const sourceRoots = ['src', 'scripts', 'portable'];
const sourceFiles = sourceRoots.flatMap(root => listFiles(path.resolve(root)));
for (const item of fs.readdirSync('.')) {
  if (fs.statSync(item).isFile() && (/\.(?:md|ts|json|rules|yaml|html)$/.test(item) || ['.gitignore', '.env.example', 'bun.lock'].includes(item))) sourceFiles.push(path.resolve(item));
}
const filtered = sourceFiles.filter(file => {
  const relative = path.relative(process.cwd(), file).replaceAll('\\', '/');
  return !/(?:^|\/)(?:node_modules|\.git|\.clinic-local|migration-private|review-proofs|build|dist)(?:\/|$)/.test(relative)
    && !/(?:^|\/)(?:config\.php|.*\.private\.[^/]+|\.env(?!\.example$)[^/]*)$/.test(relative)
    && !/\.(?:log|jpg|jpeg|png|zip|db|sqlite|clinicbackup|pem|key)$/i.test(relative)
    && !/(?:^|\/)clinic-decryption-key-[^/]+\.json$/i.test(relative);
});
for(const file of filtered)if(/"format"\s*:\s*"clinic-backup-key"/.test(fs.readFileSync(file,'utf8')))throw Error('Private decryption key file must not enter the source ZIP.');
createZip(path.join(artifacts, 'clinic-source.zip'), process.cwd(), [...new Set(filtered)]);
const hashes = fs.readdirSync(artifacts).sort().map(name => `${createHash('sha256').update(fs.readFileSync(path.join(artifacts, name))).digest('hex')}  ${name}`);
fs.writeFileSync(path.join(artifacts, 'SHA256SUMS.txt'), hashes.join('\n') + '\n');
console.log(`Prepared ${manifest.length} public files, separate SQL/tools/configuration, and current source ZIP in ${artifacts}. No patients, accounts or secrets seeded.`);
