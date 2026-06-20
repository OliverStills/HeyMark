# HeyMark Dependency Inventory — Audit

**Audit date:** 2026-06-20
**Version audited:** 1.1.0
**Auditor:** Claude Code (Phase 1 — read-only)

---

## Runtime dependencies

### pdf.js

| Field | Value |
|---|---|
| Name | PDF.js |
| Upstream | https://github.com/mozilla/pdf.js |
| Vendored path | `/vendor/pdfjs/pdf.mjs`, `/vendor/pdfjs/pdf.worker.mjs` |
| Version | Not exposed via grepping minified source; file dates 2025-05-09 |
| License | Apache 2.0 |
| License file present? | **NO** |
| Worker file | `pdf.worker.mjs` (loaded as blob: worker by pdf.js internally) |
| WASM files | None (pure JS) |
| In release manifest? | Yes — both `pdf.mjs` and `pdf.worker.mjs` hashed |
| Privileges used | Parses PDF ArrayBuffer in worker; returns text/structure to main thread |
| How loaded | `import * as pdfjsLib from '/vendor/pdfjs/pdf.mjs'` (ES module, static) |

---

### Tesseract.js

| Field | Value |
|---|---|
| Name | Tesseract.js |
| Upstream | https://github.com/naptha/tesseract.js |
| Vendored paths | `/vendor/tesseract/tesseract.esm.min.js`, `/vendor/tesseract/worker.min.js`, `/vendor/tesseract/tesseract-core-lstm.wasm`, `/vendor/tesseract/tesseract-core-simd-lstm.wasm` |
| Duplicate core path | `/vendor/tesseract-core/` (worker.min.js, tesseract-core-lstm.wasm, tesseract-core-simd-lstm.wasm, tesseract-core-lstm.wasm.js, tesseract-core-simd-lstm.wasm.js) |
| Version | Not exposed via grepping; file dates 2025-05-09 to 2025-05-15 |
| License | Apache 2.0 |
| License file present? | **NO** |
| WASM files | `tesseract-core-lstm.wasm` (2.7 MB), `tesseract-core-simd-lstm.wasm` (2.7 MB); duplicated across both vendor paths |
| In release manifest? | Yes — all files in both paths hashed |
| Privileges used | Renders canvas to PNG blob; performs OCR in worker; returns text, confidence, word bboxes |
| How loaded | Dynamic `import('/vendor/tesseract/tesseract.esm.min.js')` on first OCR conversion |

**Note:** WASM files are identical between `/vendor/tesseract/` and `/vendor/tesseract-core/` (same SHA-256). The duplication appears to be a workaround for the path the worker resolves internally. Could be deduplicated or symlinked, but is functionally safe.

---

### DOMPurify

| Field | Value |
|---|---|
| Name | DOMPurify |
| Upstream | https://github.com/cure53/DOMPurify |
| Vendored path | `/vendor/dompurify/purify.min.js` |
| Version | **3.2.4** (confirmed in source header) |
| License | Apache 2.0 / MPL 2.0 (dual) |
| License file present? | **NO** |
| In release manifest? | Yes |
| Privileges used | Sanitizes marked-parsed HTML before innerHTML assignment in preview panel |
| How loaded | UMD via `<script src="/vendor/dompurify/purify.min.js">` (synchronous, before module script) |

---

### marked

| Field | Value |
|---|---|
| Name | marked |
| Upstream | https://github.com/markedjs/marked |
| Vendored path | `/vendor/marked/marked.min.js` |
| Version | Not confirmed from grepping (minified, version string not found with tested patterns) |
| License | MIT |
| License file present? | **NO** |
| In release manifest? | Yes |
| Privileges used | Parses Markdown string to HTML string; output passed to DOMPurify before rendering |
| How loaded | UMD via `<script src="/vendor/marked/marked.min.js">` (synchronous, before module script) |

---

### JSZip

| Field | Value |
|---|---|
| Name | JSZip |
| Upstream | https://github.com/Stuk/jszip |
| Vendored path | `/vendor/jszip/jszip.min.js` |
| Version | **3.10.1** (confirmed in source) |
| License | MIT |
| License file present? | **NO** |
| In release manifest? | Yes |
| Privileges used | Packages multiple Markdown files into a ZIP blob for multi-file download |
| How loaded | UMD via `<script src="/vendor/jszip/jszip.min.js">` (synchronous, before module script) |

---

## OCR language data

| File | Path | Size | In manifest? |
|---|---|---|---|
| eng.traineddata | `/assets/tessdata/eng.traineddata` | ~10 MB | Yes |

Language options shown in the UI (French, German, Spanish, etc.) do not have corresponding `.traineddata` files vendored. Selecting a non-English language and running OCR will likely cause Tesseract to attempt fetching the file from `langPath`, which points to `/assets/tessdata` (same-origin). The file won't be found and OCR will fail or silently fall back to English. **This is not a security issue but a functional gap.**

---

## Fonts (self-hosted, no document-derived content)

All fonts are served same-origin from `/assets/fonts/`. All are covered by the release manifest.

| Font | Files | In manifest? |
|---|---|---|
| Cormorant Garamond | Regular, Bold, Italic, SemiBold (.woff2) | Yes |
| JetBrains Mono | Regular, Bold (.wasm2) | Yes |
| Libre Baskerville | Regular, Bold, Italic (.woff2) | Yes |

Font license files are not present in the repo. These are open-source fonts (SIL OFL); license obligations should be documented.

---

## License compliance gap

None of the 5 runtime libraries have their upstream LICENSE file present in the repository or vendor directories. Apache 2.0 and MIT require license text retention upon redistribution. This is an open compliance obligation documented in CLAUDE.md §5 and must be resolved before public release.

---

## Files NOT covered by release manifest

| File | Reason |
|---|---|
| `release-hash.json` | Excluded by design (manifest cannot cover itself) |
| `verify/index.html` | **Covered** — present in manifest |
| `_headers` | Not covered; Netlify header file, not a browser-loadable asset |
| `build-hashes.mjs` | Not covered; build-time script, not served at runtime |
| `serve.mjs` | Not covered; local dev server only |

The manifest covers all runtime browser assets correctly.
