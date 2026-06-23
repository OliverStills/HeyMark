#!/usr/bin/env node
/**
 * Generates encrypted-pw-heymark.pdf — a valid password-protected PDF.
 * Password: heymark
 * Algorithm: PDF Standard Security V=1 R=2 (40-bit RC4), per PDF 1.4 spec §3.5.2
 * Run: node security-tests/make-encrypted-fixture.mjs
 */

import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ── RC4 ───────────────────────────────────────────────────────────────────────

function rc4(key, data) {
  const S = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xFF;
    [S[i], S[j]] = [S[j], S[i]];
  }
  let ii = 0, jj = 0;
  return Buffer.from(data).map(byte => {
    ii = (ii + 1) & 0xFF;
    jj = (jj + S[ii]) & 0xFF;
    [S[ii], S[jj]] = [S[jj], S[ii]];
    return byte ^ S[(S[ii] + S[jj]) & 0xFF];
  });
}

// ── PDF Standard Security helpers ─────────────────────────────────────────────

const PDF_PADDING = Buffer.from([
  0x28,0xBF,0x4E,0x5E,0x4E,0x75,0x8A,0x41,
  0x64,0x00,0x4E,0x56,0xFF,0xFA,0x01,0x08,
  0x2E,0x2E,0x00,0xB6,0xD0,0x68,0x3E,0x80,
  0x2F,0x0C,0xA9,0xFE,0x64,0x53,0x69,0x7A,
]);

function padPw(pw) {
  const buf = Buffer.alloc(32);
  const src = Buffer.from(pw, 'latin1');
  const len = Math.min(src.length, 32);
  src.copy(buf, 0, 0, len);
  PDF_PADDING.copy(buf, len, 0, 32 - len);
  return buf;
}

// /O: RC4-encrypt padded user password with key derived from owner password
function computeO(userPw, ownerPw) {
  const ownerKey = createHash('md5').update(padPw(ownerPw)).digest().slice(0, 5);
  return rc4(ownerKey, padPw(userPw));
}

// Encryption key: MD5(paddedUser + O + P_LE32 + fileId), first 5 bytes
function computeEncKey(userPw, O, P, fileId) {
  const pBuf = Buffer.alloc(4);
  pBuf.writeInt32LE(P, 0);
  return createHash('md5')
    .update(padPw(userPw))
    .update(O)
    .update(pBuf)
    .update(fileId)
    .digest()
    .slice(0, 5);
}

// /U for R=2: RC4-encrypt PDF_PADDING with the encryption key
function computeU(encKey) {
  return rc4(encKey, PDF_PADDING);
}

// Per-object key: MD5(encKey + 3-byte obj_num + 2-byte gen_num)[0..9]
function perObjKey(encKey, objNum) {
  return createHash('md5')
    .update(encKey)
    .update(Buffer.from([objNum & 0xFF, (objNum >> 8) & 0xFF, (objNum >> 16) & 0xFF, 0x00, 0x00]))
    .digest()
    .slice(0, 10);
}

// ── Compute encryption values ─────────────────────────────────────────────────

const USER_PW  = 'heymark';
const FILE_ID  = Buffer.alloc(16, 0x42); // arbitrary fixed 16-byte ID
const P        = -4;                     // permissions (allow printing + reading)

const O      = computeO(USER_PW, USER_PW);
const encKey = computeEncKey(USER_PW, O, P, FILE_ID);
const U      = computeU(encKey);

// ── Encrypt the page content stream (object 5) ────────────────────────────────

const plainContent  = Buffer.from('BT /F1 14 Tf 72 720 Td (HeyMark Encrypted Test - password: heymark) Tj ET', 'latin1');
const cryptContent  = rc4(perObjKey(encKey, 5), plainContent);

// ── PDF builder ───────────────────────────────────────────────────────────────

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

function streamObj(extraDict, data) {
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data, 'ascii');
  return Buffer.concat([
    Buffer.from(`<<${extraDict}/Length ${d.length}>>\nstream\n`, 'ascii'),
    d,
    Buffer.from('\nendstream', 'ascii'),
  ]);
}

// ── Assemble PDF ──────────────────────────────────────────────────────────────

const fileIdHex = '<' + FILE_ID.toString('hex') + '>';
const Ohex = '<' + O.toString('hex') + '>';
const Uhex = '<' + U.toString('hex') + '>';

const pdf = makePdf([
  { id: 1, content: '<</Type/Catalog/Pages 2 0 R>>' },
  { id: 2, content: '<</Type/Pages/Kids[3 0 R]/Count 1>>' },
  { id: 3, content: '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>' },
  { id: 4, content: '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>' },
  { id: 5, content: streamObj('', cryptContent) },
  { id: 6, content: `<</Filter/Standard/V 1/R 2/O ${Ohex}/U ${Uhex}/P ${P}>>` },
], {
  trailerExtra: `/Encrypt 6 0 R/ID [${fileIdHex} ${fileIdHex}]`,
});

// ── Write ─────────────────────────────────────────────────────────────────────

const OUT = join(process.cwd(), 'security-tests/fixtures/pdf');
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'encrypted-pw-heymark.pdf'), pdf);
console.log(`\nWrote encrypted-pw-heymark.pdf (${pdf.length} bytes)`);
console.log(`Password: heymark\n`);
