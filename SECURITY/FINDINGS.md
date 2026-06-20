# HeyMark Security Findings — Phase 1 Audit

**Audit date:** 2026-06-20
**Version audited:** 1.1.0
**Auditor:** Claude Code (Phase 1 — read-only; no code changes made)

Findings are ordered by severity. Severity uses a three-tier scale:
**CRITICAL** = exploitable in production today without user action beyond loading the page.
**HIGH** = not immediately exploitable but creates a clear path to harm or denial of service.
**MEDIUM** = meaningful gap, but requires adversarial preconditions (e.g., compromised manifest) or has limited blast radius.
**LOW** = correctness or hygiene issue with no practical near-term security consequence.

---

## F-01 — innerHTML assignment with unsanitized manifest value

**Severity:** MEDIUM (not document-derived; requires compromised manifest to exploit)
**File:** app.js:1598–1600
**Category:** DOM injection / stored XSS precursor

### Code

```js
releaseEl.innerHTML = manifest.releaseUrl
  ? `<a href="${encodeURI(manifest.releaseUrl)}" target="_blank" rel="noopener noreferrer">${manifest.releaseUrl}</a>`
  : '—';
```

### Problem

`manifest.releaseUrl` is a string read from `/release-hash.json`, then placed:
1. As the `href` value (via `encodeURI()`)
2. As the **link text** inside the HTML string assigned to `innerHTML`

`encodeURI()` does not encode `<`, `>`, `"`, or `'`. A value like:
```
https://example.com"><script>alert(1)</script><a href="
```
would close the `href` attribute, inject a `<script>` tag into the page, and
reopen an `<a>` tag. The browser would execute the script.

Separately, the link text (`${manifest.releaseUrl}`) receives no escaping at all.
A value like `<img src=x onerror=alert(1)>` would execute as HTML.

### Why this matters in practice

The manifest is a same-origin static file hosted by Netlify. In the current
threat model, an attacker would need to:
- Compromise the Netlify deployment (hosting account), **or**
- Replace the file via a compromised CI/deploy pipeline

This is not a remote-content injection (the PDF never touches this path). However,
the integrity verifier is specifically the feature users trust to confirm the app
hasn't been tampered with. A tampered manifest that also injects script via this
path would silently compromise the verification UI — exactly the component meant
to detect tampering. This is why the severity is MEDIUM rather than LOW.

### Fix (for Phase 3)

Use DOM API calls to build the link, not a template literal assigned to `innerHTML`:

```js
if (manifest.releaseUrl) {
  const a = document.createElement('a');
  a.href = manifest.releaseUrl;             // browser validates and normalizes
  a.textContent = manifest.releaseUrl;      // text, never parsed as HTML
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  releaseEl.textContent = '';
  releaseEl.appendChild(a);
} else {
  releaseEl.textContent = '—';
}
```

Additionally, validate the URL scheme before setting `href`:
```js
const url = new URL(manifest.releaseUrl);
if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unexpected scheme');
a.href = url.href;
```

---

## F-02 — No canvas pixel-dimension guard before OCR render

**Severity:** HIGH
**File:** app.js:913–921
**Category:** Resource exhaustion / denial of service

### Code

```js
const viewport = page.getViewport({ scale: 3 });
const canvas = document.createElement('canvas');
canvas.width  = Math.round(viewport.width);
canvas.height = Math.round(viewport.height);
const ctx = canvas.getContext('2d', { willReadFrequently: true });
await page.render({ canvasContext: ctx, viewport }).promise;
```

### Problem

There is no check on `viewport.width * viewport.height` before creating the canvas.
A PDF page can have arbitrary declared dimensions. A crafted PDF with a page
declared at, say, 20,000 × 30,000 points would render at:
- 60,000 × 90,000 pixels at 3× scale
- = 5,400,000,000 pixels
- = ~21 GB of RGBA pixel data

The browser will attempt to allocate this buffer, likely crashing the tab (or the
browser on memory-constrained devices) with no user-visible error or recovery path.

Even at more modest dimensions (e.g., a page 4,000 points wide — unusual but
valid), the 3× scale produces a 12,000px-wide canvas and the `preprocessForOCR`
function then creates multiple additional off-screen canvases (for `deskewCanvas`)
multiplying memory use further.

### Fix (for Phase 3)

Before render, compute the scaled dimensions and enforce a limit:

```js
const rawViewport = page.getViewport({ scale: 1 });
const MAX_PIXELS_PER_PAGE = 40_000_000; // e.g. 40 MP
const rawPixels = rawViewport.width * rawViewport.height;
const maxScale = Math.min(3, Math.sqrt(MAX_PIXELS_PER_PAGE / rawPixels));
const viewport = page.getViewport({ scale: maxScale });
// proceed with capped viewport
```

A single centralized `SECURITY_LIMITS` constant (Phase 3) should own the
`maxRenderedPixelsPerPage` and `maxTotalRenderedPixels` values.

---

## F-03 — No per-page or total OCR timeout

**Severity:** HIGH
**File:** app.js:876–972 (`convertWithOCR`)
**Category:** Resource exhaustion / denial of service

### Problem

`worker.recognize(blob)` is awaited with no timeout. On a pathological image —
very large pixel area, extreme noise, or adversarially constructed content — a
single OCR call can run for an arbitrarily long time (minutes to hours in the
worst case). There is also no total-conversion deadline across all pages.

The user can click Cancel, which sets `rec.status = 'cancelled'` and terminates
the worker in the `finally` block on the NEXT iteration boundary. But if Tesseract
is mid-recognition on a single page, terminating the worker will abort it. The
cancel path does work, but the user must discover the hang themselves and click
Cancel manually. There is no automatic protection.

Additionally, there is no limit on the number of OCR pages. `MAX_PAGES = 2000`
applies to standard text extraction and is checked before the OCR path starts
(app.js:508–513), so it does apply. However, a 2000-page scanned document with
no timeout would run for an extremely long time.

### Fix (for Phase 3)

Wrap `worker.recognize(blob)` in a race with a per-page timeout:

```js
const OCR_PAGE_TIMEOUT_MS = 45_000;
const timeout = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('OCR timeout')), OCR_PAGE_TIMEOUT_MS)
);
const result = await Promise.race([worker.recognize(blob), timeout]);
```

Catch the timeout, push a `[OCR timed out — page N]` placeholder, and continue
to the next page rather than failing the whole document. A total deadline across
all pages should also be enforced.

---

## F-04 — No output size limit

**Severity:** HIGH
**File:** app.js:826–837 (`assembleOutput`), app.js:1501–1514 (`renderPreview`)
**Category:** Resource exhaustion / denial of service

### Problem

`assembleOutput()` accumulates page Markdown strings without a size check.
`renderPreview()` then calls `marked.parse(md)` and assigns to `innerHTML`.
A very large Markdown document (e.g., a 2000-page dense legal transcript) could
produce tens or hundreds of megabytes of Markdown, and the parse + innerHTML
assignment would freeze or crash the tab.

There is also no limit on how large an individual page's text content can be
before it is added to `pageMarkdowns`.

### Fix (for Phase 3)

After `assembleOutput()` returns, check the length against a limit:

```js
const MAX_OUTPUT_CHARS = 25_000_000;
if (markdown.length > MAX_OUTPUT_CHARS) {
  log(`Output truncated at ${MAX_OUTPUT_CHARS.toLocaleString()} characters`, 'warn');
  markdown = markdown.slice(0, MAX_OUTPUT_CHARS) + '\n\n[Output truncated]';
}
```

For the preview specifically, consider truncating further or rendering only the
visible portion (virtual scrolling), since `marked.parse` on 25 MB of Markdown
will still be slow.

---

## F-05 — CSP mismatch between _headers and index.html meta tag

**Severity:** MEDIUM
**Files:** `_headers` line 2, `index.html` lines 11–23
**Category:** Configuration drift / potential policy confusion

### Problem

Two CSP definitions exist and they differ:

| Directive | `_headers` (authoritative) | `index.html` meta tag |
|---|---|---|
| `connect-src` | `'self' blob:` | `'self' blob: data:` |
| `upgrade-insecure-requests` | **absent** | present |

The `_headers` value is what the browser enforces in production (server header
wins over meta tag). The meta tag is only a fallback for environments without
the server-set header (e.g., if `serve.mjs` is used locally without setting
headers — which it does set, via `Cross-Origin-*` headers, but the CSP in
`serve.mjs` comes from the meta tag only).

**Concrete risk:** During local development with `serve.mjs`, the effective CSP
is the meta tag one, which includes `data:` in `connect-src`. This means that
in local development (but not production) `fetch('data:...')` would be permitted.
No current code does this, but it's an inconsistency worth resolving.

### Fix (for Phase 3)

Either:
- Remove `data:` from `connect-src` in the meta tag and add `upgrade-insecure-requests`
  to `_headers`, bringing both into sync, **or**
- Remove the meta tag entirely (server header is authoritative; meta is confusing)

---

## F-06 — No upstream license files in vendor/

**Severity:** MEDIUM (legal/compliance, not runtime security)
**Files:** All of `vendor/*/`
**Category:** License compliance

### Problem

Apache 2.0 (pdf.js, Tesseract.js, DOMPurify) and MIT (marked, JSZip) both require
that the original license and copyright notice be retained when redistributing the
software. None of the five libraries have their LICENSE file present in the vendor
directories.

This was noted in CLAUDE.md §5 as an open obligation.

### Fix (for Phase 5 — Supply Chain)

Add each library's LICENSE file:
- `vendor/pdfjs/LICENSE` — Apache 2.0 (Mozilla copyright)
- `vendor/tesseract/LICENSE` — Apache 2.0 (naptha copyright)
- `vendor/tesseract-core/LICENSE` — (same upstream)
- `vendor/dompurify/LICENSE` — Apache 2.0 / MPL 2.0 dual
- `vendor/marked/LICENSE` — MIT
- `vendor/jszip/LICENSE` — MIT

Or collect them into a single `vendor/THIRD-PARTY-LICENSES.txt`.

---

## F-07 — pdf.js loadingTask not explicitly destroyed between conversions

**Severity:** LOW
**File:** app.js:490–503 (`convertFile`)
**Category:** Memory management / worker lifecycle

### Problem

`pdfjsLib.getDocument(loadParams)` returns a `loadingTask`. The code awaits
`.promise` but never calls `loadingTask.destroy()`. The pdf.js worker spawned for
the document may persist in memory holding the parsed PDF structure until the
worker process is killed by the browser.

For a user converting multiple large PDFs in sequence, this could accumulate
memory. For the OCR path, the same issue occurs (the pdf.js document is used for
page rendering and text checking).

### Fix (for Phase 3)

```js
const loadingTask = pdfjsLib.getDocument(loadParams);
try {
  const pdf = await loadingTask.promise;
  // ... process ...
} finally {
  await loadingTask.destroy();
}
```

---

## F-08 — Error messages may expose pdf.js parser internals

**Severity:** LOW
**File:** app.js:534
**Category:** Information disclosure

### Problem

`rec.error = err?.message` captures raw exception messages from pdf.js (e.g.,
`"Invalid XRef table at offset 8192"`, `"Invalid PDF structure"`). These are
displayed in the queue UI. While this does not expose document text or OCR output,
it could leak structural information about a malformed file. For the stated use
case (law firm documents), this is unlikely to matter, but it conflicts with the
roadmap's requirement that errors must not expose document-derived information.

### Fix (for Phase 3)

Map pdf.js exceptions to user-visible messages that don't include internal details:

```js
rec.error = classifyPdfError(err);

function classifyPdfError(err) {
  if (err?.name === 'PasswordException') return 'Password required';
  if (/XRef/i.test(err?.message)) return 'PDF structure is corrupt or incomplete';
  if (/stream/i.test(err?.message)) return 'PDF contains unreadable content streams';
  return 'PDF could not be parsed';
}
```

---

## F-09 — verify/index.html references MIT license, but repo's own license status is unclear

**Severity:** LOW (legal)
**File:** `verify/index.html` line 56

### Problem

`verify/index.html` states: *"The full source is published on GitHub under the
MIT license."* However, CLAUDE.md §5 notes: "If you (Oliver) intend the repo
itself to be proprietary, consider adding an explicit notice." A `LICENSE` file
exists in the repo root but the actual intent regarding the repo's own license
should be confirmed.

This is not a runtime security finding but could affect the public-facing security
claims. The Phase 6 security page should state the current actual license.

---

## Summary table

| ID | Severity | Title | Phase to fix |
|---|---|---|---|
| F-01 | MEDIUM | innerHTML via manifest releaseUrl | Phase 3 |
| F-02 | HIGH | No canvas pixel-dimension guard (OCR) | Phase 3 |
| F-03 | HIGH | No per-page / total OCR timeout | Phase 3 |
| F-04 | HIGH | No output size limit | Phase 3 |
| F-05 | MEDIUM | CSP mismatch (_headers vs meta tag) | Phase 3 |
| F-06 | MEDIUM | No upstream license files | Phase 5 |
| F-07 | LOW | pdf.js loadingTask not destroyed | Phase 3 |
| F-08 | LOW | Error messages expose parser internals | Phase 3 |
| F-09 | LOW | License claim in verify page may be inaccurate | Phase 6 |

**No CRITICAL findings.** The privacy invariants (zero egress, no storage, same-origin
assets) are all intact. The highest-risk issues are resource-exhaustion vectors (F-02,
F-03, F-04) that a crafted PDF could trigger, and the DOM injection precursor (F-01)
that would only matter if the manifest were compromised.
