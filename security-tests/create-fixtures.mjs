#!/usr/bin/env node
/**
 * Generates synthetic PDF test fixtures for HeyMark Phase 3 / Phase 4 security testing.
 * Run: node security-tests/create-fixtures.mjs
 *
 * All fixtures are synthetic — no real documents used.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'security-tests/fixtures/pdf');
mkdirSync(OUT, { recursive: true });

// ── PDF builder ────────────────────────────────────────────────────────────────

function makePdf(objects, { rootId = 1, trailerExtra = '' } = {}) {
  let pos = 0;
  const parts = [];
  const offsets = {};

  function add(buf) { parts.push(buf); pos += buf.length; }

  add(Buffer.from('%PDF-1.4\n', 'ascii'));

  for (const { id, content } of objects) {
    offsets[id] = pos;
    const body = Buffer.isBuffer(content) ? content : Buffer.from(content, 'ascii');
    add(Buffer.from(`${id} 0 obj\n`, 'ascii'));
    add(body);
    add(Buffer.from('\nendobj\n', 'ascii'));
  }

  const xrefPos = pos;
  const maxId = Math.max(...objects.map(o => o.id));
  let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= maxId; i++) {
    xref += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<</Size ${maxId + 1}/Root ${rootId} 0 R${trailerExtra}>>\nstartxref\n${xrefPos}\n%%EOF\n`;
  add(Buffer.from(xref, 'ascii'));

  return Buffer.concat(parts);
}

// Builds a stream object body (dict + inline data) for use as obj.content
function streamObj(dictExtra, data) {
  const d = typeof data === 'string' ? Buffer.from(data, 'ascii') : data;
  return Buffer.concat([
    Buffer.from(`<<${dictExtra}/Length ${d.length}>>\nstream\n`, 'ascii'),
    d,
    Buffer.from('\nendstream', 'ascii'),
  ]);
}

// Creates a PDF with N real page objects (for page-count limit tests)
function makeMultiPagePdf(pageCount) {
  const objects = [];
  objects.push({ id: 1, content: '<</Type/Catalog/Pages 2 0 R>>' });
  const kids = Array.from({ length: pageCount }, (_, i) => `${i + 3} 0 R`).join(' ');
  objects.push({ id: 2, content: `<</Type/Pages/Kids[${kids}]/Count ${pageCount}>>` });
  for (let i = 0; i < pageCount; i++) {
    objects.push({ id: i + 3, content: '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>' });
  }
  return makePdf(objects);
}

function write(name, content) {
  writeFileSync(join(OUT, name), content);
  const bytes = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content, 'ascii');
  console.log(`  ${name.padEnd(32)} ${(bytes / 1024).toFixed(1).padStart(8)} KB`);
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

console.log('\nGenerating → security-tests/fixtures/pdf/\n');

// 1. Malformed header — fails %PDF- magic-byte check in addFiles()
write('malformed-header.pdf',
  Buffer.from('%NOT-A-PDF-FILE\n1 0 obj\n<</Type/Catalog>>\nendobj\n%%EOF\n', 'ascii'));

// 2. Corrupted xref — valid %PDF- header, garbage cross-reference table
write('corrupted-xref.pdf',
  Buffer.from(
    '%PDF-1.4\n1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n' +
    'XREF_CORRUPTED\ntrailer\n<</Root 1 0 R>>\nstartxref\n99999\n%%EOF\n',
    'ascii'));

// 3. Excessive pages — 2001 real pages, triggers hard rejection (maxPdfPages = 2000)
console.log('  (generating 2001-page PDF…)');
write('excessive-pages.pdf', makeMultiPagePdf(2001));

// 4. Soft-warn pages — 502 real pages, triggers soft warning (maxPdfPagesSoftWarn = 500)
console.log('  (generating 502-page PDF…)');
write('soft-warn-pages.pdf', makeMultiPagePdf(502));

// 5. Extreme dimensions — huge MediaBox triggers canvas pixel cap
write('extreme-dimensions.pdf', makePdf([
  { id: 1, content: '<</Type/Catalog/Pages 2 0 R>>' },
  { id: 2, content: '<</Type/Pages/Kids[3 0 R]/Count 1>>' },
  { id: 3, content: '<</Type/Page/Parent 2 0 R/MediaBox[0 0 100000 100000]>>' },
]));

// 6. Embedded JavaScript — OpenAction; pdf.js surfaces this via JS events
write('embedded-js.pdf', makePdf([
  { id: 1, content: '<</Type/Catalog/Pages 2 0 R/OpenAction<</S/JavaScript/JS(app.alert(heymark-test))/Type/Action>>>>' },
  { id: 2, content: '<</Type/Pages/Kids[3 0 R]/Count 1>>' },
  { id: 3, content: '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>' },
]));

// 7. External link — safe https:// URI annotation
write('external-link.pdf', makePdf([
  { id: 1, content: '<</Type/Catalog/Pages 2 0 R>>' },
  { id: 2, content: '<</Type/Pages/Kids[3 0 R]/Count 1>>' },
  { id: 3, content: '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Annots[4 0 R]>>' },
  { id: 4, content: '<</Type/Annot/Subtype/Link/Rect[100 700 300 720]/A<</S/URI/URI(https://example.com)>>>>' },
]));

// 8. Malicious link — javascript: URI; target for sanitizeMarkdownLinks control
write('malicious-link.pdf', makePdf([
  { id: 1, content: '<</Type/Catalog/Pages 2 0 R>>' },
  { id: 2, content: '<</Type/Pages/Kids[3 0 R]/Count 1>>' },
  { id: 3, content: '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Annots[4 0 R]>>' },
  { id: 4, content: '<</Type/Annot/Subtype/Link/Rect[100 700 300 720]/A<</S/URI/URI(javascript:alert(1))>>>>' },
]));

// 9. Image-heavy — 5 image XObjects (canvas/memory pressure candidate)
{
  const px = Buffer.alloc(3, 0xff); // 1×1 white pixel, DeviceRGB
  const imgDict = '/Type/XObject/Subtype/Image/Width 1/Height 1/ColorSpace/DeviceRGB/BitsPerComponent 8';
  const xrefs = [1,2,3,4,5].map(n => `/Im${n} ${n + 4} 0 R`).join(' ');
  const ops   = [1,2,3,4,5].map(n => `q 100 0 0 100 ${(n-1)*110} 600 cm /Im${n} Do Q`).join('\n');
  write('image-heavy.pdf', makePdf([
    { id: 1, content: '<</Type/Catalog/Pages 2 0 R>>' },
    { id: 2, content: '<</Type/Pages/Kids[3 0 R]/Count 1>>' },
    { id: 3, content: `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</XObject<<${xrefs}>>>>/Contents 4 0 R>>` },
    { id: 4, content: streamObj('', ops) },
    { id: 5, content: streamObj(imgDict, px) },
    { id: 6, content: streamObj(imgDict, px) },
    { id: 7, content: streamObj(imgDict, px) },
    { id: 8, content: streamObj(imgDict, px) },
    { id: 9, content: streamObj(imgDict, px) },
  ]));
}

// 10. Empty PDF — 0 pages; tests graceful handling of page-count 0
write('empty.pdf', makePdf([
  { id: 1, content: '<</Type/Catalog/Pages 2 0 R>>' },
  { id: 2, content: '<</Type/Pages/Kids[]/Count 0>>' },
]));

// 11. Encrypted PDF — /Encrypt in trailer; triggers PasswordException in pdf.js
{
  const z = '<' + '00'.repeat(32) + '>'; // 32 zero bytes as hex string
  write('encrypted.pdf', makePdf([
    { id: 1, content: '<</Type/Catalog/Pages 2 0 R>>' },
    { id: 2, content: '<</Type/Pages/Kids[3 0 R]/Count 1>>' },
    { id: 3, content: '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>' },
    { id: 4, content: `<</Filter/Standard/V 2/R 3/O ${z}/U ${z}/P -4>>` },
  ], { trailerExtra: '/Encrypt 4 0 R' }));
}

// 12. Valid text PDF — Helvetica, standard text operators; exercises text-extraction path
{
  const text = 'BT /F1 14 Tf 72 720 Td (HeyMark Security Test - valid text fixture) Tj 0 -24 Td (Phase 3 automated proof.) Tj ET';
  write('valid-text.pdf', makePdf([
    { id: 1, content: '<</Type/Catalog/Pages 2 0 R>>' },
    { id: 2, content: '<</Type/Pages/Kids[3 0 R]/Count 1>>' },
    { id: 3, content: '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>' },
    { id: 4, content: '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>' },
    { id: 5, content: streamObj('', text) },
  ]));
}

// 13. Valid scanned PDF — image-only, no text layer; routes to OCR path
{
  const imgData = Buffer.alloc(300, 0xf0); // 10×10 light-gray pixels (DeviceRGB)
  const imgDict = '/Type/XObject/Subtype/Image/Width 10/Height 10/ColorSpace/DeviceRGB/BitsPerComponent 8';
  const ops = 'q 400 0 0 400 106 196 cm /Scan Do Q';
  write('valid-scanned.pdf', makePdf([
    { id: 1, content: '<</Type/Catalog/Pages 2 0 R>>' },
    { id: 2, content: '<</Type/Pages/Kids[3 0 R]/Count 1>>' },
    { id: 3, content: '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</XObject<</Scan 4 0 R>>>>/Contents 5 0 R>>' },
    { id: 4, content: streamObj(imgDict, imgData) },
    { id: 5, content: streamObj('', ops) },
  ]));
}

console.log(`
Done. 13 fixtures generated.

Oversized fixture (>50 MB, for file-size rejection test) — generate separately:
  node -e "const b=Buffer.alloc(51*1024*1024,0x41);b.write('%PDF-',0,'ascii');require('fs').writeFileSync('security-tests/fixtures/pdf/oversized.pdf',b)"
`);
