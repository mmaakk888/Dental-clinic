/** Pure structural relocation of the reviewed Rules. No I/O or predicate edits.
 * Shared primitives live once at database scope; exclusive helpers live at
 * their users' lowest common match inside one of four sibling clinic groups.
 */
import assert from 'node:assert/strict';

const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const bytes = source => new TextEncoder().encode(source).byteLength;

function masked(source) {
  let result = '', mode = '', quote = '';
  for (let index = 0; index < source.length; index++) {
    const value = source[index], next = source[index + 1];
    if (mode === 'line') {
      if (value === '\n') { mode = ''; result += '\n'; } else result += ' ';
      continue;
    }
    if (mode === 'block') {
      if (value === '*' && next === '/') { result += '  '; index++; mode = ''; }
      else result += value === '\n' ? '\n' : ' ';
      continue;
    }
    if (quote) {
      result += value === '\n' ? '\n' : ' ';
      if (value === '\\' && next !== undefined) { result += next === '\n' ? '\n' : ' '; index++; }
      else if (value === quote) quote = '';
      continue;
    }
    if (value === '/' && next === '/') { result += '  '; index++; mode = 'line'; continue; }
    if (value === '/' && next === '*') { result += '  '; index++; mode = 'block'; continue; }
    if (value === "'" || value === '"') { quote = value; result += ' '; } else result += value;
  }
  assert.equal(result.length, source.length);
  assert.equal(quote, '', 'Unclosed Rules string');
  assert.notEqual(mode, 'block', 'Unclosed Rules comment');
  return result;
}

function closeBrace(mask, start) {
  let depth = 0;
  for (let index = start; index < mask.length; index++) {
    if (mask[index] === '{') depth++;
    else if (mask[index] === '}' && --depth === 0) return index + 1;
  }
  throw new Error('Unbalanced Rules source');
}

function definitions(source) {
  const mask = masked(source), result = [];
  for (const match of mask.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{/g)) {
    const start = match.index, end = closeBrace(mask, start + match[0].lastIndexOf('{'));
    result.push({ name: match[1], start, end, raw: source.slice(start, end) });
  }
  assert.equal(new Set(result.map(row => row.name)).size, result.length, 'Duplicate Rules function');
  return result;
}

function matches(source) {
  const mask = masked(source), result = [];
  for (const match of mask.matchAll(/\bmatch\s+(\/[^\s]+)\s*\{/g)) {
    const start = match.index, end = closeBrace(mask, start + match[0].lastIndexOf('{'));
    result.push({ path: match[1], start, end });
  }
  for (const row of result) {
    const parents = result.filter(parent => parent !== row && parent.start < row.start && parent.end > row.end)
      .sort((a, b) => a.start - b.start);
    row.fullPath = parents.map(parent => parent.path).join('') + row.path;
  }
  return result;
}

function grants(source) {
  const mask = masked(source), blocks = matches(source), result = [];
  for (const match of mask.matchAll(/\ballow\s+[A-Za-z, ]+:/g)) {
    const end = mask.indexOf(';', match.index);
    assert.ok(end > match.index, 'Unknown allow statement');
    const parent = blocks.filter(row => row.start < match.index && row.end > end).sort((a, b) => b.start - a.start)[0];
    assert.ok(parent, 'Unscoped allow statement');
    result.push({ path: parent.fullPath, raw: source.slice(match.index, end + 1) });
  }
  return result.sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));
}

function callGraph(source) {
  const functions = definitions(source), byName = new Map(functions.map(row => [row.name, row]));
  const calls = body => [...masked(body).matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)]
    .map(match => match[1]).filter(name => byName.has(name));
  const closure = seeds => {
    const found = new Set();
    const visit = name => {
      if (found.has(name)) return;
      const definition = byName.get(name); assert.ok(definition, `Unknown Rules helper ${name}`);
      found.add(name); calls(definition.raw.slice(definition.raw.indexOf('{') + 1, -1)).forEach(visit);
    };
    seeds.forEach(visit); return found;
  };
  return { functions, byName, calls, closure };
}

/** Verify predicates and lexical binding, not merely matching function names.
 * The input is the unscoped, unique-definition source, never a deployed file.
 */
export function verifyCloudReleaseRulesScopeEquivalence(before, after) {
  const original = callGraph(before), next = definitions(after), blocks = matches(after);
  const reachable = original.closure(grants(before).flatMap(grant => original.calls(grant.raw)));
  assert.deepEqual(next.map(row => row.name).sort(), [...reachable].sort(), 'Reachable helper missing or extra helper introduced');
  for (const definition of next) {
    assert.equal(definition.raw, original.byName.get(definition.name)?.raw, `Changed predicate ${definition.name}`);
    definition.scope = blocks.filter(block => block.start < definition.start && block.end > definition.end)
      .sort((a, b) => b.start - a.start)[0];
    assert.ok(definition.scope, 'Unscoped helper');
  }
  assert.deepEqual(grants(after), grants(before), 'Changed allow predicate or effective path');
  let checkedCalls = 0;
  for (const match of masked(after).matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    const name = match[1], index = match.index;
    if (!original.byName.has(name) || next.some(row => index >= row.start && index < row.start + row.raw.indexOf('{'))) continue;
    const visible = next.filter(row => row.name === name && row.scope.start < index && row.scope.end > index)
      .sort((a, b) => b.scope.start - a.scope.start);
    assert.ok(visible.length, `Unresolved helper ${name}`);
    assert.equal(visible.filter(row => row.scope.start === visible[0].scope.start).length, 1, 'Ambiguous helper binding');
    assert.equal(visible[0].raw, original.byName.get(name).raw, 'Helper resolves to a different predicate'); checkedCalls++;
  }
  let wildcardChecks = 0;
  const originalBlocks = matches(before);
  for (const definition of next) {
    const previous = original.byName.get(definition.name);
    const previousWildcards = new Set(originalBlocks.filter(block => block.start < previous.start && block.end > previous.end)
      .flatMap(block => [...block.path.matchAll(/\{([A-Za-z_]\w*)(?:=[^}]*)?\}/g)].map(match => match[1])));
    const added = blocks.filter(block => block.start < definition.start && block.end > definition.end)
      .flatMap(block => [...block.path.matchAll(/\{([A-Za-z_]\w*)(?:=[^}]*)?\}/g)].map(match => match[1]))
      .filter(name => !previousWildcards.has(name));
    const args = /function\s+\w+\s*\(([^)]*)\)/.exec(definition.raw)[1].split(',').map(value => value.trim());
    const body = masked(definition.raw.slice(definition.raw.indexOf('{') + 1, -1));
    const locals = [...body.matchAll(/\blet\s+([A-Za-z_]\w*)/g)].map(match => match[1]);
    for (const name of added) {
      wildcardChecks++;
      if (args.includes(name) || locals.includes(name)) continue;
      assert.ok(!new RegExp('(?<![.\\w$])' + name + '(?![\\w$])').test(body), `New free wildcard capture: ${definition.name}/${name}`);
    }
  }
  const root = next.filter(row => row.scope.path === '/databases/{database}/documents');
  const leaves = blocks.filter(block => !blocks.some(child => child !== block && child.start > block.start && child.end < block.end));
  return {
    originalFunctions: original.functions.length, reachableFunctions: next.length,
    removedUnreachable: original.functions.filter(row => !reachable.has(row.name)).map(row => row.name).sort(),
    rootFunctions: root.length, sharedRootNames: root.map(row => row.name).sort(),
    maxLeafVisibleFunctions: Math.max(...leaves.map(leaf => next.filter(row => row.scope.start <= leaf.start && row.scope.end >= leaf.end).length)),
    checkedCalls, wildcardChecks, everyReachableFunctionDefinedOnce: true,
    exactReachableFunctionBodies: true, exactAllowBodies: true, effectiveGrantPathsEqual: true,
    everyUserFunctionCallResolvedToOriginalBody: true, newFreeWildcardCaptures: 0,
  };
}

export function scopeCloudReleaseRules(source, fragments) {
  const { functions, byName, calls, closure } = callGraph(source), blocks = matches(source);
  const database = blocks.find(block => block.path === '/databases/{database}/documents'); assert.ok(database);
  assert.ok(functions.every(row => blocks.filter(block => block.start < row.start && block.end > row.end).length === 1), 'Expected unscoped reviewed helpers');
  const leafBlocks = blocks.filter(block => !blocks.some(child => child !== block && child.start > block.start && child.end < block.end));
  const fallbacks = leafBlocks.filter(block => block.path === '/{document=**}'); assert.equal(fallbacks.length, 1);
  const fallback = fallbacks[0], leaves = leafBlocks.filter(block => block !== fallback);
  assert.equal(source.slice(fallback.start, fallback.end), 'match /{document=**} { allow read, write: if false; }');
  assert.ok(blocks.every(block => block === fallback || !block.path.includes('=**')), 'Broad wildcard is not a domain leaf');
  assert.ok(leaves.every(block => block.path.startsWith('/clinics/main/')), 'Unknown domain match');
  assert.equal(new Set(leaves.map(block => block.path)).size, leaves.length, 'Duplicate domain match');
  assert.deepEqual(Object.keys(fragments).sort(), ['expense', 'prosthetic', 'settings']);
  const domainPaths = Object.fromEntries(Object.entries(fragments).map(([kind, fragment]) => [kind, new Set(matches(fragment).map(block => block.path))]));
  const groups = { base: [], prosthetic: [], expense: [], settings: [] };
  for (const leaf of leaves) {
    const domains = Object.entries(domainPaths).filter(([, paths]) => paths.has(leaf.path)).map(([kind]) => kind);
    assert.ok(domains.length <= 1, 'Overlapping domain fragments');
    groups[domains[0] ?? 'base'].push({ ...leaf, relative: leaf.path.slice('/clinics/main'.length).split('/').filter(Boolean) });
  }
  for (const [kind, paths] of Object.entries(domainPaths)) assert.equal(groups[kind].length, paths.size);
  const domainUsage = new Map();
  for (const [kind, rows] of Object.entries(groups)) for (const leaf of rows) for (const name of closure(calls(source.slice(leaf.start, leaf.end)))) {
    if (!domainUsage.has(name)) domainUsage.set(name, new Set()); domainUsage.get(name).add(kind);
  }
  // Closing the shared primitives explicitly guarantees a root helper never
  // tries to resolve a dependency from a child domain or sibling match.
  const shared = closure(['owner', ...[...domainUsage].filter(([, domains]) => domains.size >= 2).map(([name]) => name)]);
  assert.ok([...shared].every(name => domainUsage.get(name)?.size >= 2 || ['owner', 'verifiedOwner', 'activeOwner'].includes(name)), 'Unrelated global helper');
  const samePrefix = (a, b) => a.length <= b.length && a.every((part, index) => part === b[index]);
  const lca = paths => { const prefix = [...paths[0]]; for (const parts of paths.slice(1)) while (!samePrefix(prefix, parts)) prefix.pop(); return prefix; };
  const key = parts => parts.join('/'), groupSources = [];
  for (const rows of Object.values(groups)) {
    const usage = new Map();
    for (const leaf of rows) for (const name of closure(calls(source.slice(leaf.start, leaf.end)))) {
      if (shared.has(name)) continue;
      if (!usage.has(name)) usage.set(name, []); usage.get(name).push(leaf.relative);
    }
    const placements = new Map([...usage].map(([name, paths]) => [name, lca(paths)]));
    const nodes = new Map([['', { parts: [], functions: [], children: [], leaf: null }]]);
    for (const leaf of rows) nodes.set(key(leaf.relative), { parts: leaf.relative, functions: [], children: [], leaf });
    for (const [name, parts] of placements) {
      if (!nodes.has(key(parts))) nodes.set(key(parts), { parts, functions: [], children: [], leaf: null });
      nodes.get(key(parts)).functions.push(byName.get(name));
    }
    for (const node of nodes.values()) {
      node.functions.sort((a, b) => a.start - b.start); if (!node.parts.length) continue;
      const parent = [...nodes.values()].filter(other => other !== node && other.parts.length < node.parts.length && samePrefix(other.parts, node.parts))
        .sort((a, b) => b.parts.length - a.parts.length)[0];
      assert.ok(parent); node.parent = parent; parent.children.push(node);
    }
    const render = node => {
      const relative = node.parts.length ? '/' + node.parts.slice(node.parent.parts.length).join('/') : '/clinics/main';
      let inner = node.functions.map(row => row.raw).join('\n');
      if (node.leaf) {
        assert.equal(node.children.length, 0);
        const raw = source.slice(node.leaf.start, node.leaf.end), header = /\bmatch\s+\/[^\s]+\s*\{/.exec(masked(raw)); assert.ok(header);
        inner += '\n' + raw.slice(header.index + header[0].lastIndexOf('{') + 1, -1);
      }
      inner += '\n' + node.children.sort((a, b) => compareText(key(a.parts), key(b.parts))).map(render).join('\n');
      return `match ${relative} {\n${inner}\n}`;
    };
    groupSources.push(render(nodes.get('')));
  }
  const raw = source.slice(database.start, database.end), header = /\bmatch\s+\/[^\s]+\s*\{/.exec(masked(raw)); assert.ok(header);
  const open = database.start + header.index + header[0].lastIndexOf('{');
  const candidate = source.slice(0, open + 1) + '\n' + functions.filter(row => shared.has(row.name)).map(row => row.raw).join('\n') + '\n'
    + groupSources.join('\n') + '\n' + source.slice(fallback.start, fallback.end) + '\n' + source.slice(database.end - 1);
  const audit = verifyCloudReleaseRulesScopeEquivalence(source, candidate);
  assert.deepEqual(audit.sharedRootNames, [...shared].sort(), 'Unexpected global helper placement');
  assert.ok(bytes(candidate) <= 256 * 1024, 'Rules source exceeds published size bound');
  return { source: candidate, audit };
}
