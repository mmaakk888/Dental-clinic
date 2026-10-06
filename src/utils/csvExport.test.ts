import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeClinicCsv, spreadsheetSafeCell } from './csvExport';

test('CSV exports neutralize formula prefixes including whitespace/control variants', () => {
  for (const text of ['=1+1', '+SUM(A1)', '-1+1', '@SUM(A1)', '  =1+1', '\t=1+1', '\r=1+1', '\n=1+1', '\u0000=1+1']) {
    assert.ok(spreadsheetSafeCell(text).replace(/^"/, '').startsWith("'"), JSON.stringify(text));
  }
  assert.equal(spreadsheetSafeCell('\tordinary text'), "'\tordinary text");
});

test('CSV escaping covers commas, double quotes, CR and LF and preserves Arabic text and numeric values', () => {
  assert.equal(spreadsheetSafeCell('أحمد'), 'أحمد');
  assert.equal(spreadsheetSafeCell('a,b'), '"a,b"');
  assert.equal(spreadsheetSafeCell('a"b'), '"a""b"');
  assert.equal(spreadsheetSafeCell('a\rb'), '"a\rb"');
  assert.equal(spreadsheetSafeCell(-25), '-25');
  assert.equal(spreadsheetSafeCell(0), '0');
  assert.equal(spreadsheetSafeCell(undefined), '');
  assert.equal(serializeClinicCsv(['اسم', 'قيمة'], [['=1+1', 25]]), '\uFEFFاسم,قيمة\r\n\'=1+1,25');
});
