#!/usr/bin/env node
/**
 * CSP verification — checks the meta Content-Security-Policy in index.html.
 * Run: node security-tests/csp-check.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

// ── Parse meta CSP ────────────────────────────────────────────────────────────

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/s);
assert(match, 'CSP meta tag not found in index.html');
const raw = match[1].replace(/\s+/g, ' ').trim();

console.log(`\nMeta CSP:\n  ${raw}\n`);

const dirs = {};
for (const part of raw.split(';').map(s => s.trim()).filter(Boolean)) {
  const [name, ...vals] = part.split(/\s+/);
  dirs[name.toLowerCase()] = vals;
}

// ── Required directives ───────────────────────────────────────────────────────

console.log('Required directives');

test("default-src 'none'", () =>
  assert(dirs['default-src']?.includes("'none'"), "default-src must be 'none'"));

test("script-src 'self'", () =>
  assert(dirs['script-src']?.includes("'self'"), "script-src must include 'self'"));

test("script-src 'wasm-unsafe-eval'", () =>
  assert(dirs['script-src']?.includes("'wasm-unsafe-eval'"), "required for pdf.js and Tesseract WASM"));

test("style-src 'self'", () =>
  assert(dirs['style-src']?.includes("'self'"), "style-src must be 'self'"));

test("font-src 'self'", () =>
  assert(dirs['font-src']?.includes("'self'"), "font-src must be 'self'"));

test("img-src allows self, data:, blob:", () => {
  assert(dirs['img-src']?.includes("'self'"), "img-src must include 'self'");
  assert(dirs['img-src']?.includes('blob:'), "img-src must include blob: (OCR canvas)");
});

test("connect-src 'self' blob:", () => {
  assert(dirs['connect-src']?.includes("'self'"), "connect-src must include 'self'");
  assert(dirs['connect-src']?.includes('blob:'), "connect-src must include blob:");
});

test("worker-src 'self' blob:", () => {
  assert(dirs['worker-src']?.includes("'self'"), "worker-src must include 'self'");
  assert(dirs['worker-src']?.includes('blob:'), "worker-src must include blob: (pdf.js worker)");
});

test("form-action 'none'", () =>
  assert(dirs['form-action']?.includes("'none'"), "form-action must be 'none'"));

test("base-uri 'none'", () =>
  assert(dirs['base-uri']?.includes("'none'"), "base-uri must be 'none'"));

test("frame-ancestors 'none'", () =>
  assert(dirs['frame-ancestors']?.includes("'none'"), "frame-ancestors must be 'none'"));

test("object-src 'none'", () =>
  assert(dirs['object-src']?.includes("'none'"), "object-src must be 'none'"));

// ── Prohibited directives ─────────────────────────────────────────────────────

console.log('\nProhibited directives');

test("no 'unsafe-inline' in script-src", () =>
  assert(!dirs['script-src']?.includes("'unsafe-inline'"), "'unsafe-inline' must not appear in script-src"));

test("no 'unsafe-eval' in script-src", () =>
  assert(!dirs['script-src']?.includes("'unsafe-eval'"), "'unsafe-eval' must not appear in script-src"));

test("no upgrade-insecure-requests (breaks localhost)", () =>
  assert(!raw.includes('upgrade-insecure-requests'), "upgrade-insecure-requests must not be in meta CSP"));

test("no external domains in script-src", () => {
  const external = (dirs['script-src'] ?? []).filter(v => v.startsWith('http') || v.startsWith('//'));
  assert(external.length === 0, `External domains in script-src: ${external.join(', ')}`);
});

test("no wildcards in default-src, script-src, connect-src", () => {
  for (const d of ['default-src', 'script-src', 'connect-src']) {
    assert(!(dirs[d] ?? []).includes('*'), `Wildcard in ${d}`);
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
