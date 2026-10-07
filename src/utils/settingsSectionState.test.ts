import test from 'node:test';
import assert from 'node:assert/strict';
import { retainVisitedSettingsSection } from '../components/settings/settingsSectionState';

test('settings visited state adds only the selected section without mutating earlier state', () => {
  const initial = new Set<'identity' | 'services' | 'drugs'>(['identity']);
  const visited = retainVisitedSettingsSection(initial, 'services');
  assert.deepEqual([...visited], ['identity', 'services']);
  assert.equal(visited.has('drugs'), false);
  assert.deepEqual([...initial], ['identity']);
});

test('revisiting a settings section reuses the visited set and retains prior entries', () => {
  const visited = new Set(['identity', 'services']);
  assert.equal(retainVisitedSettingsSection(visited, 'identity'), visited);
  assert.equal(retainVisitedSettingsSection(visited, 'services'), visited);
});
