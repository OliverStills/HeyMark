# HeyMark — Architecture Overview

**Version:** 1.1.0
**Date:** 2026-06-27

## System design

HeyMark is a static web application. It has no server-side application logic,
no database, and no backend services. The server's only role is to deliver static
files to the browser. All document processing happens in the browser on the user's
device and never leaves it.

---

## Components

| Component | Technology | Vendored path | Version |
|---|---|---|---|
| Application shell | HTML + CSS | `index.html`, `styles.css` | 1.1.0 |
| Conversion logic | Vanilla ES module | `app.js` | 1.1.0 |
| PDF parser | pdf.js (Web Worker) | `vendor/pdfjs/` | 4.10.38 |
| OCR engine | Tesseract.js + WASM | `vendor/tesseract/`, `vendor/tesseract-core/` | 5.1.1 |
| ZIP packager | JSZip | `vendor/jszip/jszip.min.js` | 3.10.1 |
| OCR language data | eng.traineddata | `assets/tessdata/` | — |
| Fonts | Web fonts | `assets/fonts/` | — |

No component is loaded from a CDN, npm registry, or any external origin at runtime.
All libraries are vendored and served same-origin.

---

## Processing model

```
User selects PDF
        ↓
Format validation (magic bytes: %PDF-)
        ↓
        ├── Text PDF path:
        │       pdf.js Web Worker (same-origin)
        │       → extracts text items, coordinates, fonts
        │       → returned to app.js via postMessage
        │       → structure reconstruction (headings, tables, lists)
        │       → Markdown string (never leaves browser)
        │
        └── Scanned PDF / OCR path:
                pdf.js Web Worker renders page to <canvas>
                → Tesseract.js Web Worker (same-origin)
                → WASM OCR engine processes pixel data
                → text returned to app.js via postMessage
                → Markdown string (never leaves browser)

Output: Markdown string → displayed in browser / downloaded as .md file
```

At no point in this pipeline does any data leave the browser process.

---

## Network model

**On first visit:** The browser downloads the app shell, JavaScript, CSS, fonts,
vendor libraries, WASM files, and OCR language data from the HeyMark origin
(`heymark.io` or `heymark.pages.dev`). These are static assets cached by the
browser for subsequent visits.

**During conversion:** Zero network requests. The browser operates entirely on
in-memory data. The Content Security Policy enforces this: `connect-src 'self' blob:`
prevents any connection to a third-party origin.

**On integrity verification:** The VERIFY feature re-fetches each runtime asset
from the same origin to compare SHA-256 hashes against the published manifest.
No document content is involved in this process.

---

## Hosting

HeyMark is deployed on Cloudflare Pages (static file delivery only). Cloudflare
acts as a CDN and does not execute any application logic. It does not receive
document content, extracted text, or generated Markdown.

See `SECURITY/SUBPROCESSORS.md` for a full subprocessor statement.

---

## Security headers (production)

Every response from `heymark.io` is served with:

| Header | Value | Purpose |
|---|---|---|
| `Content-Security-Policy` | `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' blob: data:; worker-src 'self' blob:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests` | Blocks all external resources, inline scripts, external connections |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | HTTPS enforced for 2 years |
| `Cross-Origin-Opener-Policy` | `same-origin` | Prevents cross-origin window access |
| `Cross-Origin-Embedder-Policy` | `require-corp` | Enables SharedArrayBuffer for OCR SIMD path |
| `Cross-Origin-Resource-Policy` | `same-origin` | Prevents cross-origin embedding of assets |
| `Referrer-Policy` | `no-referrer` | No referrer information sent to any origin |
| `X-Frame-Options` | `DENY` | Cannot be embedded in iframes |
| `X-Content-Type-Options` | `nosniff` | MIME type enforced |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), interest-cohort=()` | Hardware APIs and FLoC disabled |
| `Cache-Control` | `no-store` (app files) / `immutable` (vendor files) | Prevents stale app code; allows long-lived vendor caching |

---

## Dependency model

All runtime dependencies are manually vendored. No dependency is fetched from a
CDN or npm registry at runtime. When a dependency is updated:

1. The release artifact is downloaded from the upstream GitHub releases page.
2. The file is copied into `vendor/<lib>/`.
3. The full test suite (121 checks) is run.
4. The integrity manifest is regenerated (`node build-hashes.mjs`).
5. A new release is tagged and the manifest SHA-256 is published in the release notes.

See `SECURITY/DEPENDENCY-UPDATE-POLICY.md` and `SECURITY/SBOM.md`.

---

## Integrity verification model

Every release includes a `release-hash.json` manifest listing the SHA-256 hash
of every runtime file. Users can verify their deployed files match the published
source by clicking VERIFY in the app footer. The manifest's own SHA-256 is
published in the GitHub release notes, allowing independent verification that
the manifest itself has not been altered.

See `SECURITY/RELEASE-PROCESS.md`.
