/**
 * Validates DOCX test fixtures exist and have correct structure.
 * Run: node security-tests/validate-docx-fixtures.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const JSZip = require('jszip');

const FIXTURES = 'security-tests/fixtures/docx';
let passed = 0;
let failed = 0;

function ok(name)  { console.log(`  ✓ ${name}`); passed++; }
function fail(name, why) { console.error(`  ✗ ${name}: ${why}`); failed++; }

function check(label, condition, reason = '') {
  condition ? ok(label) : fail(label, reason);
}

function buf(name) {
  const path = `${FIXTURES}/${name}`;
  if (!existsSync(path)) { fail(name, 'file missing'); return null; }
  return readFileSync(path);
}

function hasZipMagic(b) {
  return b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04;
}

async function zipText(b, entryName) {
  try {
    const zip = await JSZip.loadAsync(b);
    const f = zip.file(entryName);
    if (!f) return null;
    return await f.async('text');
  } catch { return null; }
}

console.log('\nDOCX fixture validation\n');

// Presence checks
console.log('── Presence ──────────────────────────────');
const names = [
  'valid-text.docx', 'tracked-changes.docx', 'with-comments.docx',
  'malicious-link.docx', 'missing-content-types.docx', 'xlsx-as-docx.docx',
  'pptx-as-docx.docx', 'macro-docm.docx', 'not-a-zip.docx',
  'excessive-entries.docx', 'empty-body.docx',
];
for (const n of names) check(n, existsSync(`${FIXTURES}/${n}`), 'file missing');

// Content checks
console.log('\n── Content ───────────────────────────────');

const b1 = buf('valid-text.docx');
if (b1) {
  check('valid-text.docx — ZIP magic', hasZipMagic(b1));
  const ct = await zipText(b1, '[Content_Types].xml');
  check('valid-text.docx — [Content_Types].xml readable', ct !== null, 'could not read entry');
  check('valid-text.docx — wordprocessingml content type', ct?.includes('wordprocessingml') ?? false, 'missing');
  const doc = await zipText(b1, 'word/document.xml');
  check('valid-text.docx — word/document.xml readable', doc !== null, 'missing');
}

const b2 = buf('tracked-changes.docx');
if (b2) {
  check('tracked-changes.docx — ZIP magic', hasZipMagic(b2));
  const doc = await zipText(b2, 'word/document.xml');
  check('tracked-changes.docx — contains w:ins (tracked insert)', doc?.includes('w:ins') ?? false, 'no tracked change markup');
  check('tracked-changes.docx — contains w:del (tracked delete)', doc?.includes('w:del') ?? false, 'no tracked change markup');
}

const b3 = buf('malicious-link.docx');
if (b3) {
  check('malicious-link.docx — ZIP magic', hasZipMagic(b3));
  const rels = await zipText(b3, 'word/_rels/document.xml.rels');
  check('malicious-link.docx — javascript: URI in rels', rels?.includes('javascript:') ?? false, 'no malicious link');
}

const b4 = buf('missing-content-types.docx');
if (b4) {
  check('missing-content-types.docx — ZIP magic', hasZipMagic(b4));
  const ct = await zipText(b4, '[Content_Types].xml');
  check('missing-content-types.docx — no [Content_Types].xml', ct === null, 'unexpectedly has content types');
}

const b5 = buf('xlsx-as-docx.docx');
if (b5) {
  check('xlsx-as-docx.docx — ZIP magic', hasZipMagic(b5));
  const ct = await zipText(b5, '[Content_Types].xml');
  check('xlsx-as-docx.docx — spreadsheetml content type', ct?.includes('spreadsheetml') ?? false, 'missing');
}

const b6 = buf('pptx-as-docx.docx');
if (b6) {
  check('pptx-as-docx.docx — ZIP magic', hasZipMagic(b6));
  const ct = await zipText(b6, '[Content_Types].xml');
  check('pptx-as-docx.docx — presentationml content type', ct?.includes('presentationml') ?? false, 'missing');
}

const b7 = buf('macro-docm.docx');
if (b7) {
  check('macro-docm.docx — ZIP magic', hasZipMagic(b7));
  const ct = await zipText(b7, '[Content_Types].xml');
  check('macro-docm.docx — macroenabled content type', ct?.includes('macroenabled') ?? false, 'missing');
}

const b8 = buf('not-a-zip.docx');
if (b8) {
  check('not-a-zip.docx — NOT ZIP magic', !hasZipMagic(b8));
}

const b9 = buf('excessive-entries.docx');
if (b9) {
  check('excessive-entries.docx — ZIP magic', hasZipMagic(b9));
  try {
    const zip = await JSZip.loadAsync(b9);
    const count = Object.keys(zip.files).length;
    check(`excessive-entries.docx — entry count > 50 (got ${count})`, count > 50, `only ${count}`);
  } catch { fail('excessive-entries.docx — readable as ZIP', 'could not load'); }
}

// Summary
console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
