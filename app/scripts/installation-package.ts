import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createZip, listFiles} from './portable-zip';

const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const relative = (root: string, file: string) => path.relative(root, file).replaceAll('\\', '/');

/** A fresh installation, not an updater: only htdocs/ belongs in the web root. */
export function packageInstallation(releaseRoot: string, artifactsRoot: string, startGuide: string) {
  const publicRoot = path.join(releaseRoot, 'htdocs');
  const privateRoot = path.join(releaseRoot, 'sql-and-tools');
  const sourceZip = path.join(artifactsRoot, 'clinic-source.zip');
  for (const target of [releaseRoot, artifactsRoot, publicRoot, privateRoot]) {
    if (!fs.lstatSync(target).isDirectory() || fs.lstatSync(target).isSymbolicLink()) throw Error('Invalid installation input directory.');
  }
  const release = JSON.parse(fs.readFileSync(path.join(publicRoot, 'release.json'), 'utf8'));
  if (!/^[a-z0-9][a-z0-9-]{1,99}$/.test(release.version) || release.schemaVersion !== 1) throw Error('Invalid installation version.');
  const apiVersion = fs.readFileSync(path.join(publicRoot, 'api/version.php'), 'utf8').match(/SYSTEM_VERSION='([^']+)'/)?.[1];
  if (apiVersion !== release.version) throw Error('Installation version mismatch.');
  const output = path.join(artifactsRoot, `clinic-complete-${release.version}.zip`);
  const stage = path.join(releaseRoot, 'installation-bundle');
  if (fs.existsSync(output) || fs.existsSync(stage)) throw Error('Complete installation already exists; preserve it before rebuilding.');

  const publicFiles = listFiles(publicRoot);
  const manifest = JSON.parse(fs.readFileSync(path.join(releaseRoot, 'public-manifest.json'), 'utf8'));
  if (!Array.isArray(manifest.files) || manifest.files.length !== publicFiles.length) throw Error('Public file inventory mismatch.');
  const inventory = new Map<string, string>();
  for (const row of manifest.files) {
    if (typeof row.path !== 'string' || row.path.startsWith('/') || row.path.includes('\\') || row.path.split('/').some((part: string) => !part || part === '.' || part === '..') || inventory.has(row.path)) throw Error('Unsafe or duplicate public path.');
    inventory.set(row.path, row.sha256);
  }
  for (const file of publicFiles) if (inventory.get(relative(publicRoot, file)) !== sha256(file)) throw Error('Public file checksum mismatch.');
  for (const root of [publicRoot, privateRoot]) {
    for (const file of listFiles(root)) {
      const name = relative(root, file);
      if (/(?:^|\/)(?:config\.php|\.env(?:\..*)?|\.clinic-local|node_modules|.*\.private\.[^/]+|clinic-decryption-key-[^/]+\.json)$|\.(?:log|db|sqlite|clinicbackup|pem|key)$/i.test(name)) throw Error('Private runtime data in installation input.');
    }
  }
  const defaults = JSON.parse(fs.readFileSync(path.join(privateRoot, 'clinic-private/defaults.json'), 'utf8'));
  const emptyArray = (value: unknown) => Array.isArray(value) && value.length === 0;
  const emptyMap = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
  if (!emptyArray(defaults.serviceCatalog?.serviceTypes) || !emptyMap(defaults.serviceCatalog?.clinicalPrices) || !emptyMap(defaults.serviceCatalog?.crownPrices) || !emptyArray(defaults.drugCatalog) || !emptyMap(defaults.prostheticRouting?.defaultLabs) || !emptyArray(defaults.prostheticRouting?.overrides)) throw Error('Fresh installation catalogues must be empty.');
  if (/^\s*(?:INSERT|REPLACE|DROP|TRUNCATE)\b/im.test(fs.readFileSync(path.join(privateRoot, 'schema.sql'), 'utf8'))) throw Error('Installation SQL must not seed or erase data.');
  if (fs.readFileSync(sourceZip).subarray(0, 4).toString('hex') !== '504b0304') throw Error('Missing source ZIP.');

  fs.mkdirSync(stage);
  fs.cpSync(publicRoot, path.join(stage, 'htdocs'), {recursive: true});
  fs.cpSync(privateRoot, path.join(stage, 'private'), {recursive: true});
  fs.mkdirSync(path.join(stage, 'source'));
  fs.copyFileSync(sourceZip, path.join(stage, 'source/clinic-source.zip'));
  fs.copyFileSync(startGuide, path.join(stage, 'START-HERE.ar.md'));
  const files = listFiles(stage).map(file => ({path: relative(stage, file), bytes: fs.statSync(file).size, sha256: sha256(file)}));
  const receipt = {format: 'clinic-fresh-installation', formatVersion: 1, version: release.version, schemaVersion: release.schemaVersion, builtAt: release.builtAt, installation: 'empty-database-owner-created-by-installer', files};
  fs.writeFileSync(path.join(stage, 'installation-manifest.json'), JSON.stringify(receipt, null, 2));
  fs.writeFileSync(path.join(stage, 'SHA256SUMS.txt'), listFiles(stage).map(file => `${sha256(file)}  ${relative(stage, file)}`).join('\n') + '\n');
  createZip(output, stage, listFiles(stage));
  return {output, version: release.version, publicFiles: publicFiles.length, files: files.length + 2, sha256: sha256(output)};
}
