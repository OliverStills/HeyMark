#!/usr/bin/env node
/**
 * Static source analysis of app.js.
 * Checks for dangerous patterns and audits all innerHTML / fetch / import() uses.
 * Run: node security-tests/static-checks.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src   = readFileSync(join(process.cwd(), 'app.js'), 'utf8');
const lines = src.split('\n');

let passed = 0, failed = 0;

function check(name, fn) {
  const result = fn();
  if (result === true) { console.log(`  ✓ ${name}`); passed++; }
  else { console.error(`  ✗ ${name}\n    ${result}`); failed++; }
}

function firstMatch(re) {
  const m = src.match(re);
  if (!m) return null;
  const line = src.slice(0, m.index).split('\n').length;
  return { text: m[0], line };
}

// ── Zero-tolerance patterns ───────────────────────────────────────────────────

console.log('\nZero-tolerance patterns');

const banned = [
  ['no eval()',              /\beval\s*\(/],
  ['no new Function()',      /new\s+Function\s*\(/],
  ['no document.write',      /document\.write\s*\(/],
  ['no XMLHttpRequest',      /\bXMLHttpRequest\b/],
  ['no WebSocket',           /new\s+WebSocket\s*\(/],
  ['no sendBeacon',          /\bsendBeacon\b/],
  ['no EventSource',         /new\s+EventSource\s*\(/],
  ['no insertAdjacentHTML',  /\binsertAdjacentHTML\b/],
  ['no outerHTML assignment', /\.outerHTML\s*=/],
];

for (const [name, re] of banned) {
  check(name, () => {
    const m = firstMatch(re);
    return m ? `found "${m.text}" at line ${m.line}` : true;
  });
}

// ── innerHTML audit ───────────────────────────────────────────────────────────
// Allow ONLY: .innerHTML = ''  (clearing the element — safe)

console.log('\ninnerHTML audit');

check('all innerHTML assignments are empty-string clears', () => {
  const findings = [];
  for (const [i, line] of lines.entries()) {
    if (!line.includes('.innerHTML')) continue;
    if (/\.innerHTML\s*=(?!=)\s*''/.test(line)) continue; // safe: = ''
    if (!line.match(/\.innerHTML\s*=(?!=)/)) continue;    // not an assignment
    findings.push(`line ${i + 1}: ${line.trim()}`);
  }
  return findings.length === 0 ? true : findings.join('\n    ');
});

// ── fetch() audit ─────────────────────────────────────────────────────────────
// Allowed: fetch('/...') — relative URL literal (same-origin)
//          fetch(path, ...) — variable from manifest (verified: only /relative paths)

console.log('\nfetch audit');

check('all fetch() calls use same-origin paths', () => {
  const findings = [];
  for (const [i, line] of lines.entries()) {
    if (!line.includes('fetch(')) continue;
    if (/fetch\s*\(\s*'\//.test(line)) continue;    // literal relative URL
    if (/fetch\s*\(\s*path\b/.test(line)) continue; // manifest-driven path variable
    findings.push(`line ${i + 1}: ${line.trim()}`);
  }
  return findings.length === 0 ? true : findings.join('\n    ');
});

// ── dynamic import() audit ────────────────────────────────────────────────────
// Allowed: import('/vendor/...')  — local vendored library

console.log('\ndynamic import audit');

check('all dynamic import() calls load from /vendor/', () => {
  const findings = [];
  for (const [i, line] of lines.entries()) {
    const m = line.match(/\bimport\s*\(\s*['"`]([^'"` ]+)['"`]\s*\)/);
    if (!m) continue;
    if (m[1].startsWith('/vendor/')) continue;
    findings.push(`line ${i + 1}: import("${m[1]}")`);
  }
  return findings.length === 0 ? true : findings.join('\n    ');
});

// ── Remote URL patterns ───────────────────────────────────────────────────────

console.log('\nRemote URL patterns');

check('no http(s):// string literals in app.js', () => {
  const findings = [];
  for (const [i, line] of lines.entries()) {
    // Allow: comments and the GitHub URL in the footer anchor
    if (/^\s*\/\//.test(line)) continue;
    if (line.includes('github.com')) continue; // SOURCE ↗ link in footer
    const m = line.match(/https?:\/\/\S+/);
    if (m) findings.push(`line ${i + 1}: ${line.trim().slice(0, 80)}`);
  }
  return findings.length === 0 ? true : findings.join('\n    ');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
