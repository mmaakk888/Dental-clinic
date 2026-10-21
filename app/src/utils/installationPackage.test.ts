import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {packageInstallation} from '../../scripts/installation-package';
import {createZip, listFiles} from '../../scripts/portable-zip';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-install-package-'));
  const release = path.join(root, 'release'), artifacts = path.join(root, 'artifacts');
  const publicRoot = path.join(release, 'htdocs'), privateRoot = path.join(release, 'sql-and-tools');
  fs.mkdirSync(path.join(publicRoot, 'api'), {recursive: true});
  fs.mkdirSync(path.join(privateRoot, 'clinic-private'), {recursive: true});
  fs.mkdirSync(artifacts);
  const version = 'php-mysql-9-settings-scroll';
  fs.writeFileSync(path.join(publicRoot, 'release.json'), JSON.stringify({version, schemaVersion: 1, builtAt: '2026-10-21T00:00:00Z'}));
  fs.writeFileSync(path.join(publicRoot, 'api/version.php'), `<?php const SYSTEM_VERSION='${version}';`);
  fs.writeFileSync(path.join(publicRoot, '.htaccess'), 'Require all granted');
  fs.writeFileSync(path.join(privateRoot, 'schema.sql'), 'CREATE TABLE test (id INT);');
  fs.writeFileSync(path.join(privateRoot, 'clinic-private/config.example.php'), '<?php return [];');
  const defaults = {serviceCatalog: {serviceTypes: [], clinicalPrices: {}, crownPrices: {}}, drugCatalog: [], prostheticRouting: {defaultLabs: {}, overrides: []}};
  fs.writeFileSync(path.join(privateRoot, 'clinic-private/defaults.json'), JSON.stringify(defaults));
  const guide = path.join(root, 'guide.md');
  fs.writeFileSync(guide, 'الملفات الخاصة خارج جذر الدومين');
  createZip(path.join(artifacts, 'clinic-source.zip'), root, [guide]);
  fs.writeFileSync(path.join(release, 'public-manifest.json'), JSON.stringify({files: listFiles(publicRoot).map(file => ({path: path.relative(publicRoot, file).replaceAll('\\', '/'), sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex')}))}));
  return {root, release, artifacts, publicRoot, privateRoot, guide, defaults};
}

test('complete installation separates public, private and current source and hashes every entry', () => {
  const f = fixture();
  try {
    const result = packageInstallation(f.release, f.artifacts, f.guide);
    assert.ok(fs.existsSync(result.output));
    const stage = path.join(f.release, 'installation-bundle');
    assert.ok(fs.existsSync(path.join(stage, 'htdocs/.htaccess')));
    assert.ok(fs.existsSync(path.join(stage, 'private/schema.sql')));
    assert.ok(fs.existsSync(path.join(stage, 'source/clinic-source.zip')));
    assert.ok(!fs.existsSync(path.join(stage, 'htdocs/schema.sql')));
    const receipt = JSON.parse(fs.readFileSync(path.join(stage, 'installation-manifest.json'), 'utf8'));
    assert.equal(receipt.version, result.version);
    assert.equal(result.files, listFiles(stage).length);
    for (const row of receipt.files) assert.equal(row.sha256, createHash('sha256').update(fs.readFileSync(path.join(stage, row.path))).digest('hex'));
    assert.throws(() => packageInstallation(f.release, f.artifacts, f.guide), /already exists/);
  } finally { fs.rmSync(f.root, {recursive: true, force: true}); }
});

for (const change of ['tampered-public', 'extra-public', 'runtime-secret', 'seeded-catalogue', 'seeded-sql', 'mismatched-version']) {
  test(`complete installation rejects ${change} before creating an archive`, () => {
    const f = fixture();
    try {
      if (change === 'tampered-public') fs.appendFileSync(path.join(f.publicRoot, '.htaccess'), '\nchanged');
      if (change === 'extra-public') fs.writeFileSync(path.join(f.publicRoot, 'extra.txt'), 'unexpected');
      if (change === 'runtime-secret') fs.writeFileSync(path.join(f.privateRoot, 'clinic-private/config.php'), '<?php return ["password"=>"synthetic"];');
      if (change === 'seeded-catalogue') fs.writeFileSync(path.join(f.privateRoot, 'clinic-private/defaults.json'), JSON.stringify({...f.defaults, drugCatalog: ['synthetic']}));
      if (change === 'seeded-sql') fs.appendFileSync(path.join(f.privateRoot, 'schema.sql'), '\nINSERT INTO test VALUES (1);');
      if (change === 'mismatched-version') fs.writeFileSync(path.join(f.publicRoot, 'api/version.php'), "<?php const SYSTEM_VERSION='other';");
      assert.throws(() => packageInstallation(f.release, f.artifacts, f.guide));
      assert.ok(!fs.existsSync(path.join(f.release, 'installation-bundle')));
      assert.ok(!fs.readdirSync(f.artifacts).some(name => name.startsWith('clinic-complete-')));
    } finally { fs.rmSync(f.root, {recursive: true, force: true}); }
  });
}
