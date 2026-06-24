# HeyMark — Security Test Suite

## Overview

The test suite proves HeyMark's core privacy and security properties mechanically,
not by assertion. Every claim in the public-facing privacy statement maps to at
least one automated test that fails if the claim is violated.

---

## Test layers

### Layer 1 — Unit tests

**File:** `tests/phase3.test.mjs`
**Run:** `node tests/phase3.test.mjs`
**Tests:** 47

Covers pure functions that implement security controls:

- `classifyPdfError` — error messages expose no filename, path, or document content
- `sanitizeMarkdownLinks` — javascript: and data:text/html links are stripped from output
- `SECURITY_LIMITS` values — all resource caps are within approved bounds
- Pixel cap logic — oversized pages are scaled down, not rejected silently
- Preference validation — only allowlisted language codes and boolean strings are accepted
- Output truncation — oversized Markdown is truncated with a visible notice

### Layer 2 — Fixture validation

**File:** `security-tests/validate-fixtures.mjs`
**Run:** `node security-tests/validate-fixtures.mjs`
**Tests:** 38

Verifies all synthetic PDF test fixtures exist and have expected properties
(magic bytes, specific content, file size). These fixtures are used in manual
tests and will be used in the Phase 4 Playwright test matrix.

Fixtures covered: malformed header, corrupted xref, excessive pages (2001, hard
reject), soft-warn pages (502), extreme dimensions, embedded JS, external link,
malicious javascript: link, image-heavy, empty, encrypted (structure only),
encrypted with known password (heymark), valid text, valid scanned.

### Layer 3 — Static source analysis

**File:** `security-tests/static-checks.mjs`
**Run:** `node security-tests/static-checks.mjs`
**Tests:** 13

Scans `app.js` for dangerous source patterns:

- Zero-tolerance: `eval`, `new Function`, `document.write`, `XMLHttpRequest`,
  `WebSocket`, `sendBeacon`, `EventSource`, `insertAdjacentHTML`, `outerHTML=`
- `innerHTML` audit: every assignment must be `= ''` (empty-string clear only)
- `fetch()` audit: all calls must use same-origin relative URL literals or the
  integrity-manifest path variable (verified to contain only relative paths)
- `import()` audit: all dynamic imports must load from `/vendor/`
- No `http(s)://` URL literals in application code

### Layer 4 — CSP verification

**File:** `security-tests/csp-check.mjs`
**Run:** `node security-tests/csp-check.mjs`
**Tests:** 17

Parses the `<meta http-equiv="Content-Security-Policy">` tag in `index.html`
and verifies:

- All required directives are present with correct values
- Prohibited values (`unsafe-inline`, `unsafe-eval`, wildcards, external domains)
  are absent from sensitive directives
- `upgrade-insecure-requests` is absent from the meta CSP (it belongs only in
  `_headers` for the Cloudflare Pages HTTPS deployment)

### Layer 5 — Browser tests (Playwright)

**File:** `security-tests/browser/egress.spec.mjs`
**Run:** `npx playwright test`  (or `npm run test:browser`)
**Tests:** 6

Loads the full application in a real Chromium browser, intercepts all network
activity, performs a complete text-PDF conversion cycle, and verifies:

**Zero-egress:**
- No external network requests during page load
- No external network requests during PDF upload, conversion, and result display
  (all observed requests must resolve to `localhost`)

**Storage isolation:**
- `localStorage` after conversion contains only `heymark:`-prefixed keys with
  values under 200 characters (no document content)
- `sessionStorage` is empty after conversion
- No cookies are set at any point

**Output safety:**
- Markdown output contains no `javascript:` or `data:text/html` URIs

---

## Running the full suite

```bash
# All layers in order
npm test

# Individual layers
node tests/phase3.test.mjs
node security-tests/validate-fixtures.mjs
node security-tests/static-checks.mjs
node security-tests/csp-check.mjs
npx playwright test
```

Prerequisites: `npm install` and `npx playwright install chromium` (one-time setup).

The Playwright tests require the local dev server. Start it first if not running:

```bash
node serve.mjs
```

The Playwright config sets `reuseExistingServer: true`, so a running server is
reused automatically.

---

## Fixture regeneration

```bash
# Regenerate all synthetic PDF fixtures
node security-tests/create-fixtures.mjs

# Regenerate the password-protected fixture (password: heymark)
node security-tests/make-encrypted-fixture.mjs

# Regenerate the 51 MB oversized fixture (not committed to git)
node -e "const b=Buffer.alloc(51*1024*1024,0x41);b.write('%PDF-',0,'ascii');require('fs').writeFileSync('security-tests/fixtures/pdf/oversized.pdf',b)"
```

---

## Scope and limitations

**In scope (tested):**
- Zero-egress: confirmed by Playwright network interception
- Storage isolation: confirmed by Playwright storage inspection
- Output link sanitization: confirmed by unit test and browser test
- CSP directives: confirmed by static parse of index.html
- Dangerous source patterns: confirmed by static scan of app.js
- Resource limit values: confirmed by unit test

**Out of scope / not yet tested:**
- Production header verification (requires deployment; covered in Phase 5)
- IndexedDB isolation (no usage in HeyMark; no test needed)
- OCR egress (Tesseract runs locally; covered by the same network interception)
- Browser extension access to in-memory data (outside the application boundary)
- Compromised-endpoint attacks (outside the application boundary)
