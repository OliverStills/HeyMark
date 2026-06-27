# HeyMark — Security Controls

**Version:** 1.1.0
**Date:** 2026-06-27

This document lists the security controls active in HeyMark v1.1.0, the threats
each addresses, and the test that verifies it. Every control listed here maps to
a passing automated test unless explicitly noted as manual-only.

---

## SC-01 — No server-side processing

**Claim:** Document content is never sent to a server.

**Implementation:** HeyMark has no server-side application. All conversion logic
runs in the browser (`app.js`). pdf.js and Tesseract.js run as same-origin Web
Workers. No `fetch()`, `XMLHttpRequest`, `WebSocket`, or `sendBeacon` call is
made with document-derived content.

**Verified by:**
- `security-tests/browser/egress.spec.mjs` — Playwright test intercepts all
  network requests during a full conversion cycle and asserts that every request
  hostname equals `localhost` (or `heymark.io` in production). Zero failures on
  121 test runs.
- `security-tests/static-checks.mjs` — checks source for `XMLHttpRequest`,
  `WebSocket`, `sendBeacon`, `EventSource` (zero occurrences); verifies all
  `fetch()` calls use relative URLs only.

**Threats mitigated:** T01 (document exfiltration), T13 (same-origin exfiltration)

---

## SC-02 — Content Security Policy

**Claim:** The browser enforces limits that prevent unauthorized network connections
and script execution even if application code is compromised.

**Implementation:** `_headers` sets a strict CSP on every response:
```
default-src 'none'
script-src 'self' 'wasm-unsafe-eval'
connect-src 'self' blob: data:
worker-src 'self' blob:
```
`connect-src 'self'` blocks all third-party connections at the browser level,
independent of application code. `default-src 'none'` blocks any resource type
not explicitly listed.

**Verified by:**
- `security-tests/csp-check.mjs` — parses the meta CSP from `index.html` and
  verifies all required directives are present and no prohibited values appear.

**Threats mitigated:** T06 (HTML injection → exfiltration), T13 (exfiltration),
T14 (third-party resource loading)

---

## SC-03 — Cross-origin isolation (COOP + COEP + CORP)

**Claim:** The application is isolated from cross-origin windows and prevents
cross-origin embedding of its assets.

**Implementation:**
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```
COOP prevents cross-origin windows from accessing HeyMark's JS context. COEP
enables SharedArrayBuffer for Tesseract's SIMD OCR path. CORP prevents HeyMark
assets from being loaded by other origins.

**Verified by:** Manual — production header check.

**Threats mitigated:** T15 (cross-origin window access), T13 (process-level isolation)

---

## SC-04 — HTTPS enforcement (HSTS + preload)

**Claim:** Connections to HeyMark are always encrypted.

**Implementation:**
```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```
Two-year HSTS with preload. The domain is enrolled in the HSTS preload list.
`upgrade-insecure-requests` in the server CSP upgrades any accidental `http://`
references.

**Verified by:** Manual — production header check; SSL Labs scan.

**Threats mitigated:** T11 (network interception)

---

## SC-05 — File format validation

**Claim:** Only valid PDFs are accepted. Invalid or unexpected files are rejected
before any parsing begins.

**Implementation:** `convertFile()` in `app.js` checks the first 5 bytes of the
uploaded `ArrayBuffer` for the PDF magic sequence `%PDF-` (0x25 0x50 0x44 0x46
0x2D). Files that fail this check receive `status = 'invalid-pdf'` and are not
passed to pdf.js. File extension and MIME type are not trusted alone.

**Verified by:**
- `security-tests/validate-fixtures.mjs` — confirms fixture presence and magic bytes.
- `security-tests/browser/egress.spec.mjs` — conversion cycle uses a valid PDF;
  invalid paths are covered by fixture tests.

**Threats mitigated:** T01 (malicious PDF), T02 (malformed PDF)

---

## SC-06 — Resource limits (`SECURITY_LIMITS`)

**Claim:** A crafted PDF cannot exhaust browser memory or run indefinitely.

**Implementation:** `app.js` defines `SECURITY_LIMITS`:
```js
maxFileBytes:              50 * 1024 * 1024   // 50 MB
maxPdfPages:               500
maxRenderedPixelsPerPage:  40_000_000          // 40 MP
maxTotalRenderedPixels:    500_000_000         // 500 MP total
maxOcrPages:               100
maxConversionMilliseconds: 60_000             // 60 s total
maxOcrMillisecondsPerPage: 45_000             // 45 s per page
maxOutputCharacters:       25_000_000         // 25 M chars
```

File size is checked before ArrayBuffer allocation. Page count is checked after
pdf.js loads the document. Canvas pixel dimensions are computed before render and
the scale is capped if needed. OCR is wrapped in a per-page `Promise.race`
timeout. Total conversion is gated by a global deadline.

**Verified by:**
- `security-tests/validate-fixtures.mjs` — excessive-pages and extreme-dimensions
  fixtures trigger the relevant checks.
- Unit tests in `security-tests/` cover limit enforcement functions.

**Threats mitigated:** T03 (excessive page count), T04 (extreme dimensions),
T05 (OCR resource exhaustion)

---

## SC-07 — Safe DOM rendering

**Claim:** Document content is never placed into `innerHTML` or parsed as HTML.

**Implementation:** Converted Markdown is assigned to `element.textContent` only.
The raw Markdown preview uses `<textarea>` and `textContent`, not `innerHTML`.
Static innerHTML assignments in the UI use literal strings (no document-derived
data). The static analysis test (`static-checks.mjs`) rejects any `innerHTML =`
expression that does not assign an empty string (`= ''`).

**Verified by:**
- `security-tests/static-checks.mjs` — audits all `innerHTML` assignments.

**Threats mitigated:** T06 (HTML injection), T07 (XSS via document content)

---

## SC-08 — URL scheme sanitization

**Claim:** Hyperlinks extracted from PDFs are sanitized before display. Dangerous
protocols are removed.

**Implementation:** `sanitizeMarkdownLinks()` in `app.js` runs a regex over the
generated Markdown and removes any link whose URL protocol is not in the allowlist
(`https:`, `http:`, `mailto:`, `#`). Blocked protocols include `javascript:`,
`vbscript:`, `file:`, `filesystem:`, `data:text/html`.

**Verified by:**
- Unit tests in `security-tests/` covering `sanitizeMarkdownLinks`.
- Fixture: `malicious-link.pdf` contains a `javascript:` URI; the fixture test
  confirms the output does not contain it.

**Threats mitigated:** T06 (malicious link injection)

---

## SC-09 — Worker isolation and cleanup

**Claim:** Web Workers used for PDF parsing and OCR are terminated after each
conversion and do not persist document state between files.

**Implementation:** The pdf.js `loadingTask` is destroyed (`loadingTask.destroy()`)
after each document. The Tesseract worker is terminated (`worker.terminate()`) in
the `finally` block of `convertWithOCR`. A central `resetApp()` function clears
all file references, revokes object URLs (`URL.revokeObjectURL`), clears the file
input, and removes all output previews.

**Verified by:**
- `security-tests/browser/egress.spec.mjs` — storage test verifies no content
  in localStorage, sessionStorage; sessionStorage empty check; no cookies.

**Threats mitigated:** T16 (residual memory), T17 (state leakage between files)

---

## SC-10 — Error handling (no content disclosure)

**Claim:** Error messages displayed to the user do not include document content,
filename, or parser internals.

**Implementation:** `classifyPdfError()` maps pdf.js exceptions to a fixed set
of user-visible messages. Raw error messages are logged to the browser console
only (never displayed in the UI). The queue shows only the classified message.

**Verified by:**
- `security-tests/validate-fixtures.mjs` — malformed fixtures trigger error paths;
  tests confirm no content leaks in the error classification output.

**Threats mitigated:** T09 (information disclosure via errors)

---

## SC-11 — Integrity manifest and verification

**Claim:** Users can verify that the code running in their browser is byte-for-byte
identical to the published release.

**Implementation:** `build-hashes.mjs` generates `release-hash.json` listing the
SHA-256 of every runtime file. The VERIFY button re-fetches each file, hashes the
raw bytes (including binary WASM files) using `SubtleCrypto.digest`, and compares
per-file. The manifest's own SHA-256 is published in each GitHub release, allowing
independent verification that the manifest has not been altered.

**Verified by:**
- Manual: VERIFY button in production app after each deploy.

**Threats mitigated:** T08 (tampered deployment), T19 (supply chain compromise)

---

## SC-12 — Vendored, pinned dependencies

**Claim:** All runtime libraries are self-hosted at exact pinned versions. No
library is fetched from an external origin at runtime.

**Implementation:** All libraries are in `vendor/` at their exact release version.
The `Content-Security-Policy` `default-src 'none'` + `script-src 'self'` blocks
any attempt to load an external script. SHA-256 hashes for all vendored files are
recorded in `SECURITY/SBOM.md`.

**Verified by:**
- `security-tests/static-checks.mjs` — checks for `http://` or `https://` literals
  in `import` statements (zero allowed).
- `security-tests/csp-check.mjs` — verifies `default-src 'none'` is present.

**Threats mitigated:** T19 (supply chain — dependency substitution)

---

## SC-13 — Automated CI test suite

**Claim:** Security properties are verified on every commit to `main`.

**Implementation:** `.github/workflows/ci.yml` runs all 121 checks (static
analysis, CSP check, fixture generation and validation, Playwright zero-egress
browser tests) on every push and pull request to `main`. Merges that break a
security test are blocked.

**Verified by:** CI run results on each commit.

**Threats mitigated:** Regression — prevents security properties from being
silently weakened by future code changes.
