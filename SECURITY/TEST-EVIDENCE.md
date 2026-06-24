# HeyMark — Test Evidence

**Version:** 1.1.0
**Date:** 2026-06-24
**Environment:** macOS 25.5.0, Node.js (local), Chromium headless (Playwright v1.48)

---

## Layer 1 — Unit tests

**Command:** `node tests/phase3.test.mjs`

```
classifyPdfError
  ✓ password keyword
  ✓ PasswordException name
  ✓ encrypt keyword
  ✓ corrupt keyword
  ✓ invalid keyword
  ✓ InvalidPDFException name
  ✓ memory keyword
  ✓ unknown error
  ✓ null error
  ✓ empty error

sanitizeMarkdownLinks
  ✓ strips javascript: href
  ✓ strips javascript: case-insensitive
  ✓ strips Javascript: mixed case
  ✓ strips data:text/html
  ✓ strips data:text/html case-insensitive
  ✓ preserves https link
  ✓ preserves http link
  ✓ preserves relative link
  ✓ preserves data:image (allowed)
  ✓ multi-link: strips bad keeps good
  ✓ no links — passthrough

SECURITY_LIMITS
  ✓ maxFileBytes = 50 MB
  ✓ maxPdfPages = 2000
  ✓ maxPdfPagesSoftWarn = 500
  ✓ soft warn < hard cap
  ✓ maxRenderedPixelsPerPage = 40 MP
  ✓ maxTotalRenderedPixels = 500 MP
  ✓ maxOcrPages = 100
  ✓ maxConversionMs = 60s
  ✓ maxOcrMsPerPage = 45s
  ✓ maxOutputChars = 25M
  ✓ maxOcrMsPerPage < maxConversionMs

Pixel cap logic
  ✓ standard A4 at 3x fits within limit
  ✓ oversized page triggers scale reduction

Preference validation
  ✓ valid lang accepted
  ✓ fra accepted
  ✓ unknown lang rejected
  ✓ number rejected
  ✓ empty string rejected
  ✓ true string parses
  ✓ false string parses
  ✓ yes rejected
  ✓ 1 rejected
  ✓ null rejected
  ✓ undefined rejected

Output truncation
  ✓ short output not truncated
  ✓ over-limit output is truncated with notice

47 tests: 47 passed, 0 failed
```

---

## Layer 2 — Fixture validation

**Command:** `node security-tests/validate-fixtures.mjs`

```
Presence
  ✓ malformed-header.pdf exists
  ✓ corrupted-xref.pdf exists
  ✓ excessive-pages.pdf exists
  ✓ soft-warn-pages.pdf exists
  ✓ extreme-dimensions.pdf exists
  ✓ embedded-js.pdf exists
  ✓ external-link.pdf exists
  ✓ malicious-link.pdf exists
  ✓ image-heavy.pdf exists
  ✓ empty.pdf exists
  ✓ encrypted.pdf exists
  ✓ valid-text.pdf exists
  ✓ valid-scanned.pdf exists
  ✓ encrypted-pw-heymark.pdf exists

Content
  ✓ malformed-header: does NOT start with %PDF-
  ✓ corrupted-xref: starts with %PDF-
  ✓ excessive-pages: starts with %PDF-
  ✓ excessive-pages: /Count 2001
  ✓ soft-warn-pages: /Count 502
  ✓ extreme-dimensions: MediaBox contains 100000
  ✓ embedded-js: contains /JavaScript
  ✓ external-link: contains https://
  ✓ malicious-link: contains javascript:
  ✓ image-heavy: contains /Image
  ✓ empty: /Count 0
  ✓ encrypted: /Encrypt in file
  ✓ encrypted: /Standard filter
  ✓ valid-text: Helvetica font present
  ✓ valid-text: text operators present
  ✓ valid-scanned: /Image XObject present
  ✓ valid-scanned: no text operators (image-only)
  ✓ encrypted-pw-heymark: /Encrypt present
  ✓ encrypted-pw-heymark: /ID array present
  ✓ encrypted-pw-heymark: V=1 R=2 standard encryption

Size sanity
  ✓ malformed-header: < 1 KB
  ✓ excessive-pages: > 100 KB (has 2001 real pages)
  ✓ valid-text: > 200 bytes
  ✓ valid-scanned: > 200 bytes

38 tests: 38 passed, 0 failed
```

---

## Layer 3 — Static source analysis

**Command:** `node security-tests/static-checks.mjs`

```
Zero-tolerance patterns
  ✓ no eval()
  ✓ no new Function()
  ✓ no document.write
  ✓ no XMLHttpRequest
  ✓ no WebSocket
  ✓ no sendBeacon
  ✓ no EventSource
  ✓ no insertAdjacentHTML
  ✓ no outerHTML assignment

innerHTML audit
  ✓ all innerHTML assignments are empty-string clears

fetch audit
  ✓ all fetch() calls use same-origin paths

dynamic import audit
  ✓ all dynamic import() calls load from /vendor/

Remote URL patterns
  ✓ no http(s):// string literals in app.js

13 checks: 13 passed, 0 failed
```

---

## Layer 4 — CSP verification

**Command:** `node security-tests/csp-check.mjs`

```
Meta CSP:
  default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self';
  font-src 'self'; img-src 'self' data: blob:; connect-src 'self' blob:;
  worker-src 'self' blob:; form-action 'none'; base-uri 'none';
  frame-ancestors 'none'; object-src 'none';

Required directives
  ✓ default-src 'none'
  ✓ script-src 'self'
  ✓ script-src 'wasm-unsafe-eval'
  ✓ style-src 'self'
  ✓ font-src 'self'
  ✓ img-src allows self, data:, blob:
  ✓ connect-src 'self' blob:
  ✓ worker-src 'self' blob:
  ✓ form-action 'none'
  ✓ base-uri 'none'
  ✓ frame-ancestors 'none'
  ✓ object-src 'none'

Prohibited directives
  ✓ no 'unsafe-inline' in script-src
  ✓ no 'unsafe-eval' in script-src
  ✓ no upgrade-insecure-requests (breaks localhost)
  ✓ no external domains in script-src
  ✓ no wildcards in default-src, script-src, connect-src

17 checks: 17 passed, 0 failed
```

---

## Layer 5 — Browser tests

**Command:** `npx playwright test`
**Browser:** Chromium headless (playwright chromium-headless-shell v1228)

```
Running 6 tests using 1 worker

  ✓ zero-egress › PDF conversion makes no external requests (994ms)
  ✓ zero-egress › no external requests during page load (592ms)
  ✓ storage isolation › localStorage has no document content after conversion (207ms)
  ✓ storage isolation › sessionStorage is empty after conversion (194ms)
  ✓ storage isolation › no cookies are set during or after conversion (200ms)
  ✓ storage isolation › markdown output does not contain javascript: links (196ms)

  6 passed (4.2s)
```

---

## Phase 3 manual tests (completed by Oliver)

| Test | Fixture | Result |
|---|---|---|
| Oversized file rejection | `oversized.pdf` (51 MB) | Pass |
| Excessive pages hard reject | `excessive-pages.pdf` (2001 pages) | Pass |
| Soft page count warning | `soft-warn-pages.pdf` (502 pages) | Pass |
| Encrypted PDF prompt | `encrypted-pw-heymark.pdf` | Pass |
| Encrypted PDF unlock + convert | password: `heymark` | Pass |
| Malformed PDF rejection | `malformed-header.pdf` | Pass |
| Valid text PDF conversion | `valid-text.pdf` | Pass |
| Valid scanned PDF → OCR | `valid-scanned.pdf` | Pass |
| Reset/clear during conversion | any PDF | Pass |

---

## Totals

| Layer | Tests | Result |
|---|---|---|
| Unit tests | 47 | 47 passed |
| Fixture validation | 38 | 38 passed |
| Static source checks | 13 | 13 passed |
| CSP verification | 17 | 17 passed |
| Browser (Playwright) | 6 | 6 passed |
| **Total** | **121** | **121 passed** |
