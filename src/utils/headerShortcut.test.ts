import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

// Invoke the actual header effect/handler with deterministic hooks and synthetic
// event targets. No browser, live site DOM, storage records or visual QA.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = buildSync({ stdin: { resolveDir: root, loader: 'tsx', contents: `
  import {HeaderNavbar} from './src/components/common/HeaderNavbar';
  export const headerComponent = HeaderNavbar.type;
` }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent' });
const compiled = { exports: {} as { headerComponent: (props: any) => unknown } };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);

function headerShortcut(blocker: 'dialog' | 'alertdialog' | 'native' | null) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  assert.ok(internals && 'H' in internals);
  const names = ['window', 'document', 'navigator', 'localStorage'] as const;
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const previousTimeout = globalThis.setTimeout;
  const states: any[] = [], effects: (() => void | (() => void))[] = [], cleanups: (() => void)[] = [];
  let keyHandler: ((event: any) => void) | undefined, queried = 0;
  const fakeWindow = { addEventListener: (name: string, handler: any) => { if (name === 'keydown') keyHandler = handler; }, removeEventListener: () => {} };
  const fakeDocument = { addEventListener: () => {}, removeEventListener: () => {}, querySelector: (selector: string) => {
    queried++;
    const expected = blocker === 'native' ? 'dialog[open]' : blocker ? `[role="${blocker}"][aria-modal="true"]` : '';
    return expected && selector.includes(expected) ? { syntheticModal: blocker } : null;
  } };
  const globals = { window: fakeWindow, document: fakeDocument, navigator: { onLine: true }, localStorage: { getItem: () => null } };
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: globals[name] });
  globalThis.setTimeout = (() => 0) as unknown as typeof setTimeout;
  let stateIndex = 0;
  const dispatcher = {
    useState: (initial: any) => {
      const index = stateIndex++; states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], (next: any) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    },
    useRef: (initial: any) => ({ current: initial }),
    useCallback: (callback: any) => callback,
    useMemo: (factory: () => any) => factory(),
    useEffect: (effect: any) => effects.push(effect),
  };
  try {
    const priorDispatcher = internals.H; internals.H = dispatcher;
    try {
      compiled.exports.headerComponent({ clinicName: 'عيادة اختبار', patients: [], currentUser: null,
        isPrivacyMode: true, onTogglePrivacyMode() {}, onNavigate() {}, onSelectPatient() {}, onLogout() {} });
    } finally { internals.H = priorDispatcher; }
    effects.forEach(effect => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); });
    assert.ok(keyHandler, 'actual header keydown effect must subscribe');
    return { states, get queried() { return queried; }, dispatch: (modifiers: Record<string, unknown> = {}) => {
      const event = { key: 'k', ctrlKey: true, metaKey: false, altKey: false, repeat: false, prevented: false,
        preventDefault() { this.prevented = true; }, ...modifiers };
      keyHandler!(event); return event;
    }, close: () => {
      cleanups.reverse().forEach(cleanup => cleanup());
      for (const name of names) { const descriptor = previous.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
      globalThis.setTimeout = previousTimeout;
    } };
  } catch (error) {
    cleanups.reverse().forEach(cleanup => cleanup());
    for (const name of names) { const descriptor = previous.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
    globalThis.setTimeout = previousTimeout; throw error;
  }
}

test('actual Ctrl+K handler cannot open search over confirmation, regular modal or native More dialog', () => {
  for (const blocker of ['alertdialog', 'dialog', 'native'] as const) {
    const h = headerShortcut(blocker);
    try { assert.equal(h.dispatch().prevented, false); assert.equal(h.states[0], null, blocker); assert.equal(h.queried, 1); }
    finally { h.close(); }
  }
});

test('actual header shortcut still opens search without a modal and ignores unrelated/repeated modifier keys', () => {
  const h = headerShortcut(null);
  try {
    for (const modifiers of [{ key: 'x' }, { ctrlKey: false }, { altKey: true }, { repeat: true }]) h.dispatch(modifiers);
    assert.equal(h.queried, 0); assert.equal(h.states[0], null);
    assert.equal(h.dispatch({ ctrlKey: false, metaKey: true, key: 'K' }).prevented, true);
    assert.equal(h.states[0], 'search'); assert.equal(h.queried, 1);
  } finally { h.close(); }
});
