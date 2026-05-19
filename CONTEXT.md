# HeyMark — AI Context Document

> **For AI assistants reading this:** This document is your onboarding brief for the HeyMark project. It tells you what this app is, how it works under the hood, and how to help Oliver (the developer) when he asks questions about it.

---

## What Is HeyMark?

**HeyMark is a privacy-first, browser-only PDF-to-Markdown converter.** It converts PDF files into clean, readable Markdown — entirely client-side. No server, no uploads, no external API calls. The tagline says it all: *"Your files never leave your browser."*

It lives at: [https://github.com/OliverStills/HeyMark](https://github.com/OliverStills/HeyMark)  
Current version: **v1.0.0**

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Structure | Vanilla HTML5 (`index.html`) |
| Styling | Custom CSS (`styles.css`) |
| Logic | Vanilla JS ES Module (`app.js`) |
| PDF parsing | [pdf.js](https://mozilla.github.io/pdf.js/) (vendored, local) |
| OCR | [Tesseract.js](https://tesseract.projectnaptha.com/) (vendored, local) |
| Markdown parsing | [marked.js](https://marked.js.org/) (vendored, local) |
| Sanitization | [DOMPurify](https://github.com/cure53/DOMPurify) (vendored, local) |
| ZIP export | [JSZip](https://stuk.github.io/jszip/) (vendored, local) |
| Hosting | Netlify (static, no serverless functions) |

All vendor libraries are bundled locally under `/vendor/` — there are zero CDN calls at runtime. This is intentional for privacy and integrity verification.

---

## How It Works (Core Flow)

1. **File Ingestion** — User drops, selects, or pastes PDF files. Files are validated (50 MB max, 50 files max, magic bytes checked for `%PDF-`).

2. **Conversion Pipeline** — Two modes:
   - **Standard Mode** (default): Uses `pdf.js` to extract embedded text. Text items are extracted with coordinates (x, y, height, fontName) and reconstructed into reading order.
   - **OCR Mode**: Uses `Tesseract.js` to render each page to a canvas at 2× scale, then runs optical character recognition. Supports 10 languages. On pages that already have embedded text, OCR mode skips to standard extraction (hybrid approach).

3. **Reading Order Reconstruction** — A custom algorithm (`reconstructReadingOrder`) detects two-column layouts by clustering X positions around the page midpoint, sorts items top-to-bottom per column, and strips headers/footers (top/bottom 7% of page height).

4. **Markdown Construction** — `buildPageMarkdown` groups text items into lines by Y-coordinate proximity (~2px tolerance), infers heading levels from relative font size (H1 ≥ 2× median, H2 ≥ 1.5×, H3 ≥ 1.2×), detects bullet/ordered lists, rejoins soft-hyphenated words, and inserts paragraph breaks based on vertical gap size.

5. **Output** — Results are displayed in a Raw Markdown view and a live Preview tab (rendered with `marked.js`, sanitized by `DOMPurify`). Users can copy to clipboard, download as `.md`, or export multiple files as a `.zip`.

---

## Configurable Options

| Option | Default | Description |
|--------|---------|-------------|
| **OCR Mode** | Off | Enables Tesseract.js for scanned/image-based PDFs |
| **Language** | English | OCR language (10 supported) |
| **Extended MD** | Off | Toggle for table and footnote detection (UI toggle, logic hook) |
| **Normalize Chars** | On | Applies Unicode NFC normalization to extracted text |
| **Preserve Hyphens** | On | Keeps compound hyphenated words (e.g., `self-service`, `cross-platform`) using a known prefix list |

---

## Security Architecture

HeyMark uses a strict **Content Security Policy (CSP)** that:
- Blocks all external network requests (`connect-src 'self' blob: data:` only)
- Disallows iframes, forms, and object embeds
- Permits WASM via `wasm-unsafe-eval` (required for pdf.js)

An **integrity verification panel** is built-in: it computes a SHA-256 hash of all loaded HTML, scripts, and stylesheets, then compares it against a published `release-hash.json`. This lets users confirm the live app matches the open-source release.

---

## File Structure

```
HeyMark/
├── index.html          # App shell, CSP, options bar, drop zone, result panel
├── app.js              # All logic: state, conversion, OCR, rendering, downloads
├── styles.css          # All styles
├── _headers            # Netlify HTTP headers (CSP, cache control)
├── release-hash.json   # SHA-256 hash for integrity verification
├── LICENSE             # MIT
├── assets/
│   └── tessdata/       # Tesseract language data files (.traineddata)
├── vendor/
│   ├── pdfjs/          # pdf.js (pdf.mjs + pdf.worker.mjs)
│   ├── tesseract/      # Tesseract.js ESM + worker
│   ├── tesseract-core/ # WASM core for Tesseract
│   ├── marked/         # marked.min.js
│   ├── dompurify/      # purify.min.js
│   └── jszip/          # jszip.min.js
└── verify/             # Standalone integrity verification page
```

---

## State Model

The app uses a single `state` object:
- `state.files` — Array of `FileRecord` objects tracking each PDF's id, name, sanitized name, status, progress, page count, markdown output, error, and active Tesseract worker reference.
- `state.activeIdx` — Which completed file is displayed in the result panel.
- `state.activeTab` — `'raw'` or `'preview'`.
- `state.options` — User-selected conversion options (see above).

File statuses: `queued → converting / ocr → complete | failed | cancelled | no-text | size-exceeded | page-exceeded | invalid-pdf | encrypted`

---

## Developer Context

- **Built by:** Oliver Sandoval ([@OliverStills](https://github.com/OliverStills)), Chicago, IL
- **Goal:** A trustworthy, zero-dependency-at-runtime PDF conversion tool with a strong privacy guarantee — no cloud, no tracking, no data retention.
- **Stack philosophy:** Everything vendored and local. No npm build pipeline. Pure ES modules. Deploy by pushing static files to Netlify.
- **Common tasks Oliver works on:** improving Markdown fidelity (heading detection, table parsing), adding new languages to OCR, performance on large/multi-page PDFs, UI polish, and ensuring the CSP stays tight.

---

*This file was generated to give AI assistants immediate project context. When Oliver asks you a question about HeyMark, assume he knows the codebase well and prefers direct, technical answers.*
