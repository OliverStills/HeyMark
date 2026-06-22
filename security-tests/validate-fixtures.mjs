#!/usr/bin/env node
/**
 * Validates all security test fixtures are present and have expected properties.
 * Run after create-fixtures.mjs: node security-tests/validate-fixtures.mjs
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(process.cwd(), 'security-tests/fixtures/pdf');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

function exists(name) { return existsSync(join(FIXTURES, name)); }
function read(name) { return readFileSync(join(FIXTURES, name)); }
function readStr(name) { return read(name).toString('ascii'); }
function startsWith(name, pfx) {
  const buf = read(name);
  return buf.slice(0, pfx.length).equals(Buffer.from(pfx, 'ascii'));
}
function fileSize(name) { return statSync(join(FIXTURES, name)).size; }

// ── Presence ──────────────────────────────────────────────────────────────────

console.log('\nPresence');
const required = [
  'malformed-header.pdf',
  'corrupted-xref.pdf',
  'excessive-pages.pdf',
  'soft-warn-pages.pdf',
  'extreme-dimensions.pdf',
  'embedded-js.pdf',
  'external-link.pdf',
  'malicious-link.pdf',
  'image-heavy.pdf',
  'empty.pdf',
  'encrypted.pdf',
  'valid-text.pdf',
  'valid-scanned.pdf',
];
for (const name of required) {
  test(`${name} exists`, () => assert(exists(name), `not found in ${FIXTURES}`));
}

// ── Content ───────────────────────────────────────────────────────────────────

console.log('\nContent');

test('malformed-header: does NOT start with %PDF-', () =>
  assert(!startsWith('malformed-header.pdf', '%PDF-'), 'should not start with %PDF-'));

test('corrupted-xref: starts with %PDF-', () =>
  assert(startsWith('corrupted-xref.pdf', '%PDF-'), 'should start with %PDF-'));

test('excessive-pages: starts with %PDF-', () =>
  assert(startsWith('excessive-pages.pdf', '%PDF-'), 'should start with %PDF-'));

test('excessive-pages: /Count 2001', () =>
  assert(readStr('excessive-pages.pdf').includes('/Count 2001'), 'expected /Count 2001'));

test('soft-warn-pages: /Count 502', () =>
  assert(readStr('soft-warn-pages.pdf').includes('/Count 502'), 'expected /Count 502'));

test('extreme-dimensions: MediaBox contains 100000', () =>
  assert(readStr('extreme-dimensions.pdf').includes('100000'), 'expected 100000 in MediaBox'));

test('embedded-js: contains /JavaScript', () =>
  assert(readStr('embedded-js.pdf').includes('JavaScript'), 'expected JavaScript action'));

test('external-link: contains https://', () =>
  assert(readStr('external-link.pdf').includes('https://'), 'expected https:// URI'));

test('malicious-link: contains javascript:', () =>
  assert(readStr('malicious-link.pdf').toLowerCase().includes('javascript:'), 'expected javascript: URI'));

test('image-heavy: contains /Image', () =>
  assert(readStr('image-heavy.pdf').includes('/Image'), 'expected /Image XObject'));

test('empty: /Count 0', () =>
  assert(readStr('empty.pdf').includes('/Count 0'), 'expected /Count 0'));

test('encrypted: /Encrypt in file', () =>
  assert(readStr('encrypted.pdf').includes('/Encrypt'), 'expected /Encrypt reference'));

test('encrypted: /Standard filter', () =>
  assert(readStr('encrypted.pdf').includes('/Standard'), 'expected /Standard encryption filter'));

test('valid-text: Helvetica font present', () =>
  assert(readStr('valid-text.pdf').includes('Helvetica'), 'expected Helvetica font'));

test('valid-text: text operators present', () =>
  assert(readStr('valid-text.pdf').includes(' Tj'), 'expected Tj text operator'));

test('valid-scanned: /Image XObject present', () =>
  assert(readStr('valid-scanned.pdf').includes('/Image'), 'expected /Image XObject'));

test('valid-scanned: no text operators (image-only)', () =>
  assert(!readStr('valid-scanned.pdf').includes(' Tj'), 'scanned fixture must have no text layer'));

// ── Size sanity ───────────────────────────────────────────────────────────────

console.log('\nSize sanity');

test('malformed-header: < 1 KB', () =>
  assert(fileSize('malformed-header.pdf') < 1024, `expected < 1 KB`));

test('excessive-pages: > 100 KB (has 2001 real pages)', () =>
  assert(fileSize('excessive-pages.pdf') > 100 * 1024, `expected > 100 KB`));

test('valid-text: > 200 bytes', () =>
  assert(fileSize('valid-text.pdf') > 200, 'expected non-trivial file'));

test('valid-scanned: > 200 bytes', () =>
  assert(fileSize('valid-scanned.pdf') > 200, 'expected non-trivial file'));

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
