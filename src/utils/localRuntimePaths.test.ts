import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('private local tooling uses the clinic directory and stays outside published files', () => {
  for (const file of ['scripts/test-portable-api.mjs', 'scripts/test-system-update.ts', 'scripts/package-update.ts', 'scripts/build-portable.ts', '.gitignore', 'tsconfig.json', 'AGENTS.md']) {
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /clinic-local/, file);
    assert.doesNotMatch(text, /\.fire(?:base)(?:[/\\]|\b)/i, file);
  }
  assert.match(fs.readFileSync('.gitignore', 'utf8'), /^\.clinic-local\/$/m);
  assert.ok(JSON.parse(fs.readFileSync('tsconfig.json', 'utf8')).exclude.includes('.clinic-local'));
});

test('current instructions and visible notices do not name the retired provider', () => {
  for (const file of ['README.md', 'portable/INSTALL.ar.md', 'portable/UPDATE.ar.md', 'portable/WORKFLOW.ar.md', 'portable/VERIFICATION.ar.md', 'portable/DESIGN-REVIEW.ar.md', 'src/components/common/HeaderNavbar.tsx', 'src/components/settings/EmptyClinicCard.tsx']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /fire(?:base)|فاير\s?بيز/i, file);
  }
});

test('workflow guide is included in the separate private release documents', () => {
  const source = fs.readFileSync('scripts/build-portable.ts', 'utf8');
  assert.match(source, /for \(const file of \[[^\]]*'WORKFLOW\.ar\.md'[^\]]*\]\) \{\s*fs\.copyFileSync\(path\.join\('portable', file\), path\.join\(privateDir, file\)\)/);
});
