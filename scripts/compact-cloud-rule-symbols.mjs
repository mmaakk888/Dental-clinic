/** Pure alpha-renaming: no field, string, path, predicate or capacity changes.
 * Keep readable Rules in the reviewed fragments; only deployment symbols shrink. */
import assert from 'node:assert/strict';

function codeMask(source) {
  let result = '', mode = '', quote = '';
  for (let index = 0; index < source.length; index++) {
    const value = source[index], next = source[index + 1];
    if (mode === 'line') { if (value === '\n') { mode = ''; result += '\n'; } else result += ' '; continue; }
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
  assert.equal(result.length, source.length); assert.equal(quote, ''); assert.notEqual(mode, 'block');
  return result;
}

function renameCalls(source, mapping) {
  const mask = codeMask(source), edits = [];
  for (const token of mask.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) {
    const replacement = mapping.get(token[0]);
    if (!replacement) continue;
    const before = mask.slice(0, token.index).trimEnd();
    const after = mask.slice(token.index + token[0].length).trimStart();
    // Rules has no function values; calls and declarations have an opening
    // parenthesis. Never rewrite member methods or similarly named fields.
    if (!after.startsWith('(') || before.endsWith('.')) continue;
    edits.push({ start: token.index, end: token.index + token[0].length, replacement });
  }
  let result = source;
  for (const edit of edits.reverse()) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  return { source: result, renamedOccurrences: edits.length };
}

export function compactCloudRuleSymbols(source) {
  const mask = codeMask(source), allIdentifiers = new Set([...mask.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)].map(match => match[0]));
  const names = [...mask.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map(match => match[1]);
  const uniqueNames = [...new Set(names)], mapping = new Map(); let counter = 0;
  const frequencies = new Map(uniqueNames.map(name => [name, 0]));
  for (const call of mask.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    if (frequencies.has(call[1])) frequencies.set(call[1], frequencies.get(call[1]) + 1);
  }
  uniqueNames.sort((a, b) => frequencies.get(b) - frequencies.get(a));
  const nextName = () => {
    let value = counter++, name = '';
    do { name = String.fromCharCode(65 + value % 26) + name; value = Math.floor(value / 26) - 1; } while (value >= 0);
    return name;
  };
  for (const name of uniqueNames) {
    let short;
    do { short = nextName(); } while (allIdentifiers.has(short));
    allIdentifiers.add(short); mapping.set(name, short);
  }
  const result = renameCalls(source, mapping);
  const reverse = new Map([...mapping].map(([name, short]) => [short, name]));
  assert.equal(reverse.size, mapping.size, 'Non-bijective Rules symbol map');
  const restored = renameCalls(result.source, reverse);
  assert.equal(restored.source, source, 'Rule symbol compaction changed more than function identifiers');
  assert.equal(restored.renamedOccurrences, result.renamedOccurrences);
  return { ...result, functionNames: mapping.size, definitions: names.length, restoredExactly: true };
}
