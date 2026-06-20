# HeyMark Current-State Security Audit

**Audit date:** 2026-06-20
**Version audited:** 1.1.0
**Auditor:** Claude Code (Phase 1 — read-only; no code changes made)

---

## Scope

Full static read of `app.js`, `index.html`, `verify/index.html`, `_headers`,
`styles.css`, `build-hashes.mjs`, `release-hash.json`, and all vendor file
metadata. No runtime testing performed (that is the manual checkpoint, below).

---

## Network behavior

**Outcome: CLEAN — no egress of document-derived data found.**

Searched for: `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource`,
`navigator.sendBeacon`, remote imports, external workers, external fonts, external images.

Results:
- `fetch` appears at app.js:1587 and app.js:1608 — both inside the VERIFY button handler.
  Fetches are to `/release-hash.json` and same-origin asset paths listed in the manifest.
  No document content is present in any request parameter, body, or header.
- All library imports are same-origin static paths. No CDN URLs found.
- No `XMLHttpRequest`, `WebSocket`, `sendBeacon`, or `EventSource` found anywhere.
- The pdf.js worker and Tesseract worker are loaded as same-origin blob: workers
  (pdf.js creates the blob internally from `/vendor/pdfjs/pdf.worker.mjs`; Tesseract
  loads from `/vendor/tesseract/worker.min.js`).

---

## Browser storage

**Outcome: NONE FOUND.**

Searched for: `localStorage`, `sessionStorage`, `indexedDB`, `CacheStorage`,
`caches.open`, `document.cookie`, `serviceWorker`.

No hits in any application file. Document-derived data is held only in JavaScript
heap (`state.files[]` array) and is lost on page reload.

---

## DOM injection

**Outcome: ONE SIGNIFICANT FINDING — see FINDINGS.md F-01.**

All `innerHTML` usages found:

| Line | Usage | Content | Safe? |
|---|---|---|---|
| app.js:117 | `$('activity-log').innerHTML = ''` | Empty string (clear) | Yes |
| app.js:301 | `fileQueue.innerHTML = ''` | Empty string (clear) | Yes |
| app.js:1384 | `fileQueue.innerHTML = ''` | Empty string (clear) | Yes |
| app.js:1386 | `previewPanel.innerHTML = ''` | Empty string (clear) | Yes |
| app.js:1458 | `fileSelectorRow.innerHTML = ''` | Empty string (clear) | Yes |
| app.js:1511 | `previewPanel.innerHTML = safe` | DOMPurify output | Conditionally safe |
| app.js:1598–1600 | `releaseEl.innerHTML = manifest.releaseUrl ? \`<a href="${encodeURI(...)}">...\`\` | Manifest JSON value | **UNSAFE — see F-01** |

`previewPanel.innerHTML = safe` (app.js:1511): the content is the output of
`DOMPurify.sanitize(html, allowlist)`. The allowlist is narrow and well-formed
(h1–h6, p, ul, ol, li, strong, em, code, pre, blockquote, table, thead, tbody,
tr, th, td, hr, a; only `href` and `title` attributes allowed; script/style/iframe
explicitly forbidden). This is the correct pattern.

`releaseEl.innerHTML` (app.js:1598–1600): the `manifest.releaseUrl` string is
injected as both the href value (via `encodeURI()`) and the link text. `encodeURI()`
does not escape `<`, `>`, or `"`, so a crafted manifest string could break out of
the attribute or inject HTML into the link text. See FINDINGS.md F-01 for full detail.

File names are displayed via `textContent` (app.js:319), not `innerHTML`. Safe.
Error messages are displayed via `textContent` (app.js:397). Safe.
Queue item construction uses `createElement` + `textContent` throughout. Safe.

---

## Dynamic execution

**Outcome: CLEAN.**

Searched for: `eval`, `new Function`, `setTimeout` with string argument,
`setInterval` with string argument.

Only `setTimeout` found (app.js:144): `setTimeout(() => { toastEl.textContent = ''; }, 2500)`.
Callback is a function, not a string. Safe. No `eval` or `new Function` anywhere.

---

## Worker isolation and lifecycle

### pdf.js worker
- Created by `pdfjsLib.getDocument()` internally; uses same-origin
  `/vendor/pdfjs/pdf.worker.mjs`
- Worker origin: `blob:` (pdf.js constructs a blob URL internally)
- Termination: pdf.js terminates the worker when the document is destroyed or
  the page is unloaded. `pdf.getDocument()` returns a loadingTask; `.destroy()`
  is not called explicitly in app.js — the worker may persist between conversions.
- Cancellation: if `rec.status === 'cancelled'`, the page loop exits before the
  next `pdf.getPage()` call, but any in-progress `pdf.getPage()` or
  `page.getTextContent()` call is not cancelled mid-flight.
- Timeout: NONE. No deadline on pdf.js parsing.
- Memory: `page.cleanup()` called after each page's text is extracted. The
  `ArrayBuffer` passed to `getDocument()` is held by pdf.js for the document's
  lifetime (no way to release it early without `loadingTask.destroy()`).

### Tesseract.js worker
- Created by `createWorker()` with explicit paths (same-origin)
- Terminated in `finally` block — worker always terminated even on error or cancel
- `rec.worker` reference saved so `cancelOrRemove()` can call `.terminate()`
- Cancellation: `rec.status === 'cancelled'` checked before each page loop
  iteration; worker is still terminated in `finally`
- Per-page timeout: NONE. A single OCR page can stall indefinitely.
- Total timeout: NONE.
- Canvas per-page: created, used, and dereferenced each iteration. GC-able.
  But no explicit pixel-dimension check before render (see F-02).

---

## File validation

| Check | Implemented | Limit | Location |
|---|---|---|---|
| File size | Yes | 50 MB | `addFiles()`, checked on ingestion |
| File count | Yes | 50 files | `addFiles()` |
| Magic bytes | Yes | `%PDF-` (5 bytes) | `convertFile()` before pdf.js |
| Page count | Yes | 2000 pages | `convertFile()` after pdf.js load |
| MIME type | No | — | Not checked; magic bytes used instead |
| Extension | No | — | Not checked; magic bytes used instead |
| Canvas pixel dimensions | **No** | — | **Missing — see F-02** |
| Per-page OCR timeout | **No** | — | **Missing — see F-03** |
| Total conversion timeout | **No** | — | **Missing — see F-03** |
| Output size limit | **No** | — | **Missing — see F-04** |
| Encrypted PDF | Yes | — | Caught via PasswordException |
| Malformed PDF | Partial | — | pdf.js throws; caught generically; error.message exposed in queue |

---

## Deployment and headers

### _headers (Netlify — authoritative)

```
Content-Security-Policy:
  default-src 'none'
  script-src 'self' 'wasm-unsafe-eval'
  style-src 'self'
  font-src 'self'
  img-src 'self' data: blob:
  connect-src 'self' blob:
  worker-src 'self' blob:
  form-action 'none'
  base-uri 'none'
  frame-ancestors 'none'
  object-src 'none'
  upgrade-insecure-requests    ← NOT in _headers (see F-05)

Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
X-Frame-Options: DENY
Cache-Control: no-store (global)
```

### index.html meta CSP (informational backup, NOT authoritative)

```
connect-src 'self' blob: data:   ← adds 'data:' not in _headers (see F-05)
upgrade-insecure-requests        ← present here, absent in _headers (see F-05)
```

### Assessment

The CSP is strong. Key observations:
- `'wasm-unsafe-eval'` required for pdf.js and Tesseract WASM. This is the minimum
  necessary; cannot be removed without breaking those libraries.
- No `'unsafe-inline'` or `'unsafe-eval'` for scripts. Correct.
- `connect-src` does not include any third-party origin. Correct.
- HSTS is set with preload and subdomains. Good.
- COOP + COEP enable SharedArrayBuffer for Tesseract SIMD. Correct.
- `interest-cohort=()` in Permissions-Policy is the FLoC-era directive; current
  replacement is `browsing-topics=()`. Cosmetic gap.
- Two minor discrepancies between `_headers` and meta CSP (F-05). The `_headers`
  value is what actually takes effect in production; the meta tag would only apply
  if the headers were absent.
- `frame-ancestors 'none'` and `X-Frame-Options: DENY` are redundant but harmless;
  belt-and-suspenders is fine here.

### verify/index.html CSP
```
default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self';
form-action 'none'; base-uri 'none'; frame-ancestors 'none';
```
This page has no JavaScript at all. The CSP correctly blocks scripts. Correct.

---

## Error message exposure

`rec.error` is set to `err?.message` (app.js:534). This can expose internal
pdf.js error messages (e.g., parser error strings, offset values, stream names)
which are then displayed in the queue UI (app.js:397 via `textContent`). The
text does not contain document content but may contain structural hints about
the file (e.g., "Invalid XRef table at offset 12345"). This is a low-priority
information disclosure concern.

---

## Confirmed ABSENT (good)

- No analytics, telemetry, or session replay
- No CDN or remote library loading
- No service workers
- No localStorage / sessionStorage / IndexedDB / Cookie usage
- No `eval` or `new Function`
- No string-based `setTimeout`/`setInterval`
- No cross-origin requests from app logic
- File names rendered via `textContent` only
- Markdown output (raw tab) rendered via `textContent` only
- DOMPurify in place before any preview `innerHTML` assignment
