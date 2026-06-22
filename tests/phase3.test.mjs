/**
 * Phase 3 security controls — unit tests for pure functions.
 * Run with: node tests/phase3.test.mjs
 */

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ── Replicated pure functions (can't import browser ES module) ────────────────

function classifyPdfError(err) {
  const msg = err?.message || '';
  const name = err?.name || '';
  if (/password|encrypt/i.test(msg) || name === 'PasswordException') return 'PDF is password-protected.';
  if (/invalid|corrupt|malformed/i.test(msg) || /UnknownErrorException|InvalidPDFException/i.test(name)) return 'The file appears to be corrupted or is not a valid PDF.';
  if (/out of memory|memory/i.test(msg)) return 'The PDF is too large to process.';
  return 'An error occurred while processing this PDF.';
}

function sanitizeMarkdownLinks(md) {
  return md.replace(/\[([^\]]*)\]\(([^)]*)\)/g, (match, text, url) => {
    const trimmed = url.trim();
    if (/^javascript:/i.test(trimmed) || /^data:text\/html/i.test(trimmed)) return `[${text}]()`;
    return match;
  });
}

const SECURITY_LIMITS = {
  maxFileBytes:             50 * 1024 * 1024,
  maxPdfPages:              2000,
  maxPdfPagesSoftWarn:      500,
  maxRenderedPixelsPerPage: 40_000_000,
  maxTotalRenderedPixels:   500_000_000,
  maxOcrPages:              100,
  maxConversionMs:          60_000,
  maxOcrMsPerPage:          45_000,
  maxOutputChars:           25_000_000,
};

const VALID_LANGS = ['eng','fra','deu','spa','ita','por','nld','pol','ces','vie'];
function validatePrefLang(val) { return typeof val === 'string' && VALID_LANGS.includes(val) ? val : null; }
function validatePrefBool(val) { return val === 'true' ? true : val === 'false' ? false : null; }

// ── classifyPdfError ──────────────────────────────────────────────────────────

console.log('\nclassifyPdfError');
test('password keyword', () => assertEqual(classifyPdfError(new Error('incorrect password')), 'PDF is password-protected.'));
test('PasswordException name', () => assertEqual(classifyPdfError(Object.assign(new Error(''), { name: 'PasswordException' })), 'PDF is password-protected.'));
test('encrypt keyword', () => assertEqual(classifyPdfError(new Error('encrypted document')), 'PDF is password-protected.'));
test('corrupt keyword', () => assertEqual(classifyPdfError(new Error('corrupt stream')), 'The file appears to be corrupted or is not a valid PDF.'));
test('invalid keyword', () => assertEqual(classifyPdfError(new Error('invalid structure')), 'The file appears to be corrupted or is not a valid PDF.'));
test('InvalidPDFException name', () => assertEqual(classifyPdfError(Object.assign(new Error(''), { name: 'InvalidPDFException' })), 'The file appears to be corrupted or is not a valid PDF.'));
test('memory keyword', () => assertEqual(classifyPdfError(new Error('out of memory')), 'The PDF is too large to process.'));
test('unknown error', () => assertEqual(classifyPdfError(new Error('something unexpected')), 'An error occurred while processing this PDF.'));
test('null error', () => assertEqual(classifyPdfError(null), 'An error occurred while processing this PDF.'));
test('empty error', () => assertEqual(classifyPdfError({}), 'An error occurred while processing this PDF.'));

// ── sanitizeMarkdownLinks ─────────────────────────────────────────────────────

console.log('\nsanitizeMarkdownLinks');
test('strips javascript: href', () => assertEqual(sanitizeMarkdownLinks('[x](javascript:void)'), '[x]()'));
test('strips javascript: case-insensitive', () => assertEqual(sanitizeMarkdownLinks('[x](JAVASCRIPT:void)'), '[x]()'));
test('strips Javascript: mixed case', () => assertEqual(sanitizeMarkdownLinks('[x](Javascript:x)'), '[x]()'));
test('strips data:text/html', () => assertEqual(sanitizeMarkdownLinks('[x](data:text/html,<h1>hi</h1>)'), '[x]()'));
test('strips data:text/html case-insensitive', () => assertEqual(sanitizeMarkdownLinks('[x](DATA:TEXT/HTML,foo)'), '[x]()'));
test('preserves https link', () => assertEqual(sanitizeMarkdownLinks('[x](https://example.com)'), '[x](https://example.com)'));
test('preserves http link', () => assertEqual(sanitizeMarkdownLinks('[x](http://example.com)'), '[x](http://example.com)'));
test('preserves relative link', () => assertEqual(sanitizeMarkdownLinks('[x](./doc.pdf)'), '[x](./doc.pdf)'));
test('preserves data:image (allowed)', () => assertEqual(sanitizeMarkdownLinks('[x](data:image/png;base64,abc)'), '[x](data:image/png;base64,abc)'));
test('multi-link: strips bad keeps good', () => {
  const out = sanitizeMarkdownLinks('[bad](javascript:x) and [good](https://ok.com)');
  assert(out.includes('[bad]()'), 'javascript: link not stripped');
  assert(out.includes('[good](https://ok.com)'), 'https link incorrectly removed');
});
test('no links — passthrough', () => {
  const md = '# Heading\n\nSome paragraph text with no links.';
  assertEqual(sanitizeMarkdownLinks(md), md);
});

// ── SECURITY_LIMITS values ────────────────────────────────────────────────────

console.log('\nSECURITY_LIMITS');
test('maxFileBytes = 50 MB', () => assertEqual(SECURITY_LIMITS.maxFileBytes, 50 * 1024 * 1024));
test('maxPdfPages = 2000', () => assertEqual(SECURITY_LIMITS.maxPdfPages, 2000));
test('maxPdfPagesSoftWarn = 500', () => assertEqual(SECURITY_LIMITS.maxPdfPagesSoftWarn, 500));
test('soft warn < hard cap', () => assert(SECURITY_LIMITS.maxPdfPagesSoftWarn < SECURITY_LIMITS.maxPdfPages));
test('maxRenderedPixelsPerPage = 40 MP', () => assertEqual(SECURITY_LIMITS.maxRenderedPixelsPerPage, 40_000_000));
test('maxTotalRenderedPixels = 500 MP', () => assertEqual(SECURITY_LIMITS.maxTotalRenderedPixels, 500_000_000));
test('maxOcrPages = 100', () => assertEqual(SECURITY_LIMITS.maxOcrPages, 100));
test('maxConversionMs = 60s', () => assertEqual(SECURITY_LIMITS.maxConversionMs, 60_000));
test('maxOcrMsPerPage = 45s', () => assertEqual(SECURITY_LIMITS.maxOcrMsPerPage, 45_000));
test('maxOutputChars = 25M', () => assertEqual(SECURITY_LIMITS.maxOutputChars, 25_000_000));
test('maxOcrMsPerPage < maxConversionMs', () => assert(SECURITY_LIMITS.maxOcrMsPerPage < SECURITY_LIMITS.maxConversionMs));

// ── Pixel cap logic ───────────────────────────────────────────────────────────

console.log('\nPixel cap logic');
test('standard A4 at 3x fits within limit', () => {
  const w = 595, h = 842; // A4 at 1x points
  const pixels = w * h * 3 * 3;
  assert(pixels < SECURITY_LIMITS.maxRenderedPixelsPerPage, `${pixels} should be < ${SECURITY_LIMITS.maxRenderedPixelsPerPage}`);
});
test('oversized page triggers scale reduction', () => {
  const w = 5000, h = 7000; // extreme page
  const rawPixels = w * h;
  const ocrScale = 3;
  if (rawPixels * ocrScale * ocrScale > SECURITY_LIMITS.maxRenderedPixelsPerPage) {
    const reducedScale = Math.sqrt(SECURITY_LIMITS.maxRenderedPixelsPerPage / rawPixels);
    assert(reducedScale < 3, `scale should be reduced from 3, got ${reducedScale}`);
    assert(rawPixels * reducedScale * reducedScale <= SECURITY_LIMITS.maxRenderedPixelsPerPage + 1, 'capped pixels should not exceed limit');
  }
});

// ── Preference validation ─────────────────────────────────────────────────────

console.log('\nPreference validation');
test('valid lang accepted', () => assertEqual(validatePrefLang('eng'), 'eng'));
test('fra accepted', () => assertEqual(validatePrefLang('fra'), 'fra'));
test('unknown lang rejected', () => assertEqual(validatePrefLang('xyz'), null));
test('number rejected', () => assertEqual(validatePrefLang(42), null));
test('empty string rejected', () => assertEqual(validatePrefLang(''), null));
test('true string parses', () => assertEqual(validatePrefBool('true'), true));
test('false string parses', () => assertEqual(validatePrefBool('false'), false));
test('yes rejected', () => assertEqual(validatePrefBool('yes'), null));
test('1 rejected', () => assertEqual(validatePrefBool('1'), null));
test('null rejected', () => assertEqual(validatePrefBool(null), null));
test('undefined rejected', () => assertEqual(validatePrefBool(undefined), null));

// ── Output truncation logic ───────────────────────────────────────────────────

console.log('\nOutput truncation');
test('short output not truncated', () => {
  const md = 'Hello world';
  const result = md.length > SECURITY_LIMITS.maxOutputChars
    ? md.slice(0, SECURITY_LIMITS.maxOutputChars) + '\n\n[Output truncated — document too large]'
    : md;
  assertEqual(result, md);
});
test('over-limit output is truncated with notice', () => {
  const md = 'x'.repeat(SECURITY_LIMITS.maxOutputChars + 1);
  const result = md.length > SECURITY_LIMITS.maxOutputChars
    ? md.slice(0, SECURITY_LIMITS.maxOutputChars) + '\n\n[Output truncated — document too large]'
    : md;
  assert(result.endsWith('[Output truncated — document too large]'), 'truncation notice missing');
  assert(result.length === SECURITY_LIMITS.maxOutputChars + '\n\n[Output truncated — document too large]'.length, 'truncated length incorrect');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
