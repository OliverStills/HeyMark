# HeyMark Security Controls Map

**Date:** 2026-06-21
**Version:** 1.1.0
**Auditor:** Claude Code — Phase 2 (no code changes)

Maps every implemented security control to the threats it mitigates.
Read alongside THREAT-MODEL.md and RISK-REGISTER.md.

---

## C01 — Content Security Policy (server header, _headers)

```
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
```

| Threat mitigated | How |
|---|---|
| T06 (HTML injection) | Blocks inline script execution even if DOMPurify is bypassed |
| T08 (Manifest injection) | Blocks inline script execution from tampered manifest value |
| T13 (Same-origin exfiltration) | `connect-src 'self'` blocks all third-party fetches |
| T14 (Third-party resource loading) | `default-src 'none'` blocks any external resource |

**Gap:** Meta tag CSP in index.html has `data:` in `connect-src` and `upgrade-insecure-requests` not in `_headers`. These differ. Server header wins in production; meta tag is the effective policy locally (F-05). Fix in Phase 3.

---

## C02 — Cross-Origin Isolation (COOP + COEP + CORP)

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin (global)
Cross-Origin-Resource-Policy: cross-origin (tesseract/tessdata paths)
```

| Threat mitigated | How |
|---|---|
| T15 (Extension access) | Partial — COOP prevents cross-origin window access; does not block content scripts |
| T13 (Exfiltration) | Process isolation limits cross-origin memory sharing |

**Note:** COEP enables SharedArrayBuffer for Tesseract's SIMD path. The `cross-origin` CORP overrides on tesseract and tessdata paths are necessary for the worker's WASM load chain.

---

## C03 — HSTS

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

| Threat mitigated | How |
|---|---|
| T12 (Domain hijack) | Returning users (with HSTS cached) refuse HTTP connections; downgrade attacks blocked |

**Gap:** New users or those whose HSTS hasn't been cached have no protection against a DNS hijack that serves HTTP.

---

## C04 — Referrer-Policy: no-referrer

| Threat mitigated | How |
|---|---|
| T14 (Third-party resource loading) | Suppresses Referer header on any outbound request, preventing metadata leakage |
| T17 (Clipboard exposure) | No URL is leaked to any external destination |

---

## C05 — X-Frame-Options: DENY + frame-ancestors 'none'

| Threat mitigated | How |
|---|---|
| Clickjacking | App cannot be embedded in an iframe on another origin |

**Note:** Redundant but harmless — belt-and-suspenders. `frame-ancestors` in CSP is the modern standard; `X-Frame-Options` covers older browsers.

---

## C06 — PDF magic-byte validation

Code: `app.js:474–482`

Reads the first 5 bytes of the uploaded file and confirms they are `%PDF-` (0x25 0x50 0x44 0x46 0x2D). Rejects immediately if invalid.

| Threat mitigated | How |
|---|---|
| T01 (Malicious PDF) | Non-PDF files never reach the pdf.js parser |
| T02 (Malformed PDF) | Reduces surface; truncated files often fail this check |

**Gap:** Only checks 5 bytes. A file that starts with `%PDF-` but is otherwise malformed passes. pdf.js handles further validation.

---

## C07 — File size limit (50 MB)

Code: `app.js:11`, `app.js:269`

Checked on ingestion in `addFiles()`. Files exceeding 50 MB are immediately marked `size-exceeded` and never read or parsed.

| Threat mitigated | How |
|---|---|
| T01 (Malicious PDF) | Limits parser input size; reduces exploitation surface |
| T04 (Canvas memory) | Reduces maximum possible canvas size indirectly |
| T05 (OCR exhaustion) | Limits input to Tesseract |

**Gap:** A 50 MB PDF with a page declared as 10,000 × 10,000 points can still exhaust canvas memory. Canvas pixel limits (F-02) are the correct complementary control.

---

## C08 — Page count limit (2000 pages hard / 500 soft — Phase 3)

Code: `app.js:508–513` (hard limit)

| Threat mitigated | How |
|---|---|
| T03 (Excessive pages) | Hard-rejects PDFs exceeding 2000 pages |
| T05 (OCR exhaustion) | Caps the number of OCR passes |

**Gap:** 500-page soft warning not yet implemented. Add in Phase 3.

---

## C09 — pdf.js worker isolation

The pdf.js library spawns a Web Worker to parse PDF content. Worker processes are isolated from the main thread in a separate browser process with restricted permissions.

| Threat mitigated | How |
|---|---|
| T01 (Malicious PDF) | Parser exploit is sandboxed in worker; cannot directly access main thread DOM or cookies |
| T02 (Malformed PDF) | Parser crash is contained to the worker |

**Gap:** `loadingTask.destroy()` is not called (F-07). Worker may persist between conversions, accumulating memory.

---

## C10 — Tesseract worker isolation + termination

Code: `app.js:850–965`

Tesseract worker is created on first OCR use, assigned to `rec.worker`, and terminated in a `finally` block.

| Threat mitigated | How |
|---|---|
| T05 (OCR exhaustion) | User cancel triggers `worker.terminate()`; `finally` guarantees termination even on error |
| T01 (Malicious PDF) | OCR processing isolated in worker |

**Gap:** No per-page timeout — worker must be manually cancelled; no automatic recovery from a hung page (F-03).

---

## C11 — DOMPurify sanitization (Preview tab — being removed in Phase 3)

Code: `app.js:1503–1514`

`window.DOMPurify.sanitize(html, allowlist)` is called before `previewPanel.innerHTML` is set. Allowlist: `h1–h6, p, ul, ol, li, strong, em, code, pre, blockquote, table, thead, tbody, tr, th, td, hr, a`; attributes: `href, title` only.

| Threat mitigated | How |
|---|---|
| T06 (HTML injection) | Strips tags and attributes not on the allowlist; blocks event handlers, scripts, inline styles |

**Status:** Being removed in Phase 3 (Preview tab removed). Threat T06 eliminated.

---

## C12 — textContent for filename and raw output display

Code: `app.js:319` (filename), `app.js:1495` (raw panel)

File names and raw Markdown output are always set via `.textContent`, never `.innerHTML`.

| Threat mitigated | How |
|---|---|
| T06 (HTML injection) | Filename and Markdown text are never parsed as HTML |
| T07 (Malicious hyperlink) | Links in raw output are rendered as plain text, not clickable anchors |

---

## C13 — Integrity manifest (release-hash.json + VERIFY button)

Code: `app.js:1580–1644`, `build-hashes.mjs`

SHA-256 hashes of all runtime assets are recorded at build time. The VERIFY button re-fetches and hashes each file, comparing against the manifest.

| Threat mitigated | How |
|---|---|
| T09 (Compromised dependency) | Detects unauthorized changes to vendored library files |
| T20 (Manifest replacement) | Manifest's own hash published in GitHub release notes; users can verify the manifest itself |

**Gap:** UX for verifying the manifest's own hash is not surfaced in the VERIFY UI (relies on users consulting GitHub release notes).

---

## C14 — MFA on GitHub (confirmed)

| Threat mitigated | How |
|---|---|
| T10 (Compromised GitHub account) | Second factor required for authentication; phishing of password alone insufficient |

**Gap:** Branch protection not confirmed. MFA type (TOTP vs hardware key) not recorded.

---

## C15 — beforeunload warning

Code: `app.js:1556–1562`

Browser shows a confirmation dialog if the user navigates away while completed results are present.

| Threat mitigated | How |
|---|---|
| T19 (Accidental disclosure) | Prevents accidental navigation before user has downloaded or copied results |

---

## C16 — Vendored libraries (no CDN, no runtime npm)

All runtime libraries (pdf.js, Tesseract.js, DOMPurify, marked, JSZip) are served same-origin from `vendor/`.

| Threat mitigated | How |
|---|---|
| T09 (Compromised dependency) | No third-party CDN can serve malicious code at runtime |
| T14 (Third-party resource loading) | No external domain is contacted for library loading |

---

## Controls not yet implemented (target: Phase 3)

| Control | Threat | Priority |
|---|---|---|
| Canvas pixel dimension limit | T04 | HIGH |
| Per-page OCR timeout | T05 | HIGH |
| Total conversion timeout | T05 | HIGH |
| Output size cap | Denial of service | HIGH |
| Preview tab removal | T06 | HIGH (eliminates threat) |
| Fix `releaseEl.innerHTML` (F-01) | T08 | MEDIUM |
| localStorage preference storage with validation | T18 | MEDIUM |
| 500-page soft warning | T03 | LOW |
| `loadingTask.destroy()` | T02 | LOW |
| Error message sanitization | F-08 | LOW |
| URL scheme filter in Markdown output | T07 | LOW |
| Download advisory | T19, T21 | LOW |
| CSP meta tag / _headers sync | F-05 | MEDIUM |
