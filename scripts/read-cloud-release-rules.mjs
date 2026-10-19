/** Load only the reproducible complete Rules candidate for DEMO acceptance. */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { composeCloudReleaseRules } from './build-cloud-release-rules.mjs';
export function readCloudReleaseRules() {
  const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const actual = read('firestore.release.rules');
  const fragments = Object.fromEntries(['prosthetic', 'expense', 'settings'].map(kind => [kind, read(`rules/${kind}.release.rules.fragment`)]));
  assert.equal(actual, composeCloudReleaseRules(read('rules/base.release.rules'), fragments), 'DEMO must test the complete generated release, without fallback composition');
  return actual;
}
