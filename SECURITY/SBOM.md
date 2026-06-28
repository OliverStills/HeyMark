# HeyMark — Software Bill of Materials (SBOM)

**Version:** 1.2.0
**Date:** 2026-06-27
**Format:** Manual inventory (no runtime npm; all dependencies vendored)

All runtime dependencies are vendored under `vendor/` and served same-origin.
No dependency is fetched from a CDN, npm registry, or any external origin at runtime.

---

## Runtime dependencies

These files are loaded by the browser during normal use.

### pdf.js

| Field | Value |
|---|---|
| Name | pdf.js |
| Version | 4.10.38 |
| Upstream | https://github.com/mozilla/pdf.js |
| License | Apache-2.0 |
| Vendored paths | `vendor/pdfjs/pdf.mjs`, `vendor/pdfjs/pdf.worker.mjs` |
| Purpose | PDF parsing and text extraction |
| Privileges | Reads ArrayBuffer of uploaded PDF; spawns a Web Worker |
| Last reviewed | 2026-06-24 |
| Update source | https://github.com/mozilla/pdf.js/releases |
| Known CVEs | None at time of review |

**SHA-256 hashes:**
```
vendor/pdfjs/pdf.mjs        a209a2124baa35cbb9015b809926f1bcec9dd1c247296290e205dd9d76cb9128
vendor/pdfjs/pdf.worker.mjs 7c237f83fa56bce645d8af51d183c9c56ba7b2d2928ff42754dc7020bea36323
```

---

### Tesseract.js

| Field | Value |
|---|---|
| Name | Tesseract.js |
| Version | 5.1.1 |
| Upstream | https://github.com/naptha/tesseract.js |
| License | Apache-2.0 |
| Vendored paths | `vendor/tesseract/tesseract.esm.min.js`, `vendor/tesseract/worker.min.js`, `vendor/tesseract/tesseract-core-lstm.wasm`, `vendor/tesseract/tesseract-core-simd-lstm.wasm`, `vendor/tesseract-core/` (worker support files) |
| Purpose | In-browser OCR for scanned PDFs (OCR mode only) |
| Privileges | Reads canvas pixel data; spawns a Web Worker; loads WASM; requires `wasm-unsafe-eval` CSP |
| Last reviewed | 2026-06-24 |
| Update source | https://github.com/naptha/tesseract.js/releases |
| Known CVEs | None at time of review |

**SHA-256 hashes:**
```
vendor/tesseract/tesseract.esm.min.js          2537be686335e4b2637e933cdc85a52dd80267a592689c1bd63235c8591540ae
vendor/tesseract/worker.min.js                 aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc
vendor/tesseract/tesseract-core-lstm.wasm      e3984b51617f138181d8ca157493be9afc8c764897e2f8bf57581b0422fc0f28
vendor/tesseract/tesseract-core-simd-lstm.wasm 93c9afba9a946d18630a4f130d71615de6251617f583d810bae1a5b0fa28d8a3
vendor/tesseract-core/worker.min.js            aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc
vendor/tesseract-core/tesseract-core-lstm.wasm      e3984b51617f138181d8ca157493be9afc8c764897e2f8bf57581b0422fc0f28
vendor/tesseract-core/tesseract-core-lstm.wasm.js   79bc1719fc7e8fd16430621b4df273b56b0172ce7634fe380c01197147350777
vendor/tesseract-core/tesseract-core-simd-lstm.wasm 93c9afba9a946d18630a4f130d71615de6251617f583d810bae1a5b0fa28d8a3
vendor/tesseract-core/tesseract-core-simd-lstm.wasm.js 2773366915c9db41c7bb136d62b18fa581c2c1b175f429c794ef6256bbdf6719
```

---

### JSZip

| Field | Value |
|---|---|
| Name | JSZip |
| Version | 3.10.1 |
| Upstream | https://github.com/Stuk/jszip |
| License | MIT |
| Vendored paths | `vendor/jszip/jszip.min.js` |
| Purpose | Packages multiple converted Markdown files into a single .zip download |
| Privileges | Reads Markdown strings from memory (no document access after conversion); creates Blob URL |
| Last reviewed | 2026-06-24 |
| Update source | https://github.com/Stuk/jszip/releases |
| Known CVEs | None at time of review |

**SHA-256 hashes:**
```
vendor/jszip/jszip.min.js acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e
```

---

---

### Mammoth.js

| Field | Value |
|---|---|
| Name | Mammoth.js |
| Version | 1.12.0 |
| Upstream | https://github.com/mwilliamson/mammoth.js |
| License | BSD 2-Clause |
| Vendored paths | `vendor/mammoth/mammoth.browser.min.js` |
| Purpose | DOCX → HTML conversion inside an isolated Web Worker |
| Privileges | Reads ArrayBuffer of uploaded DOCX; no DOM access; runs in worker |
| Last reviewed | 2026-06-27 |
| Update source | https://github.com/mwilliamson/mammoth.js/releases |
| Known CVEs | None at time of review |

**SHA-256 hashes:**
```
vendor/mammoth/mammoth.browser.min.js 5d4c0e7c9165d70b78f789c5274a2c7846d9e1c06ec19b69afa6ef45f789a3b9
```

---

### DOMPurify

| Field | Value |
|---|---|
| Name | DOMPurify |
| Version | 3.2.4 |
| Upstream | https://github.com/cure53/DOMPurify |
| License | Apache-2.0 / MPL-2.0 |
| Vendored paths | `vendor/dompurify/purify.min.js` |
| Purpose | Sanitizes Mammoth HTML output before DOM parsing in DOCX pipeline |
| Privileges | Processes HTML string in main thread using a sandboxed document; no network access |
| Last reviewed | 2026-06-27 |
| Update source | https://github.com/cure53/DOMPurify/releases |
| Known CVEs | None at time of review |

**SHA-256 hashes:**
```
vendor/dompurify/purify.min.js 8eb41b658831fab175fad9bcd00fcb2d84e0ed3a25a55053d4ecd4444b8b43a0
```

---

## Vendored but not loaded at runtime

These libraries are present in the repository but are not imported by `app.js`
or `index.html`. They are excluded from the integrity manifest.

| Name | Version | License | Reason not used |
|---|---|---|---|
| marked | 15.0.12 | MIT | Preview tab removed in v1.1.0 |

---

## Update procedure

See `SECURITY/DEPENDENCY-UPDATE-POLICY.md`.

All updates require:
1. Download new release from upstream (verify the release signature / hash where available)
2. Replace vendored file(s)
3. Run `node --check app.js` and `npm test`
4. Run `node build-hashes.mjs` to regenerate `release-hash.json`
5. Update version, SHA-256, and last-reviewed date in this file
6. Commit and cut a new release per `SECURITY/RELEASE-PROCESS.md`
