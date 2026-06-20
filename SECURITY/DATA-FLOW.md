# HeyMark Data Flow — Audit

**Audit date:** 2026-06-20
**Version audited:** 1.1.0
**Auditor:** Claude Code (Phase 1 — read-only)

---

## Document-derived data lifecycle

```
[1] FILE SELECTION
    User selects, drops, or pastes a PDF via:
    - <input type="file"> (FileReader API)
    - drag-and-drop (DataTransfer.files)
    - navigator.clipboard.read() / clipboardData.items (paste)
    ↓ File object held in state.files[].file

[2] BROWSER MEMORY (ArrayBuffer)
    readFileAsArrayBuffer() calls FileReader.readAsArrayBuffer()
    → produces ArrayBuffer held locally in convertFile() stack frame
    → File object in state.files[].file retained until cancelOrRemove() or clearAllBtn

[3] FORMAT VALIDATION (magic bytes)
    First 5 bytes read from ArrayBuffer: 0x25 0x50 0x44 0x46 0x2D (%PDF-)
    Rejected immediately if invalid → rec.status = 'invalid-pdf'
    No content leaves the browser at any point here.

[4] PDF PARSER (pdf.js, in-browser worker)
    pdfjsLib.getDocument({ data: buf }) passes the ArrayBuffer to the
    pdf.js worker (/vendor/pdfjs/pdf.worker.mjs, same-origin blob worker).
    - Worker spawned by pdf.js library internally
    - All parsing occurs inside the worker, in memory
    - Page count checked against MAX_PAGES (2000) after load
    - Encrypted PDFs caught and surfaced to user for password entry

[5a] STANDARD TEXT EXTRACTION PATH
    For each page:
      page.getTextContent() → array of {str, transform, height, width, fontName}
      page.cleanup() called after extraction
      Items → reconstructReadingOrder() → groupIntoLines() →
      headingPrefix() / detectTableBlocks() / buildTable() / buildPageMarkdown()
      → page Markdown string accumulated in pageMarkdowns[]

[5b] OCR PATH (Tesseract.js, in-browser worker)
    Dynamic import of /vendor/tesseract/tesseract.esm.min.js (same-origin)
    Worker created at /vendor/tesseract/worker.min.js (same-origin)
    WASM core loaded from /vendor/tesseract-core/ (same-origin)
    OCR language data from /assets/tessdata/eng.traineddata (same-origin)

    For pages WITHOUT embedded text:
      page rendered to off-screen <canvas> at 3× scale
      preprocessForOCR(): grayscale + Otsu binarization on the canvas pixel buffer
      deskewCanvas(): projection-profile deskew on a 350-pixel-high downsampled copy
      canvas.toBlob() → PNG Blob (in memory)
      worker.recognize(blob) → { data: { text, confidence, lines, words } }
      buildPageMarkdownFromOCR() / detectRuledLines() / buildRuledTable()
      → page Markdown string

    Tesseract worker terminated in finally block after all pages processed.
    Canvas elements are garbage-collectable after each page (no array retained).

[6] MARKDOWN GENERATION
    assembleOutput(name, pageMarkdowns) joins page strings with --- separators
    Result stored in rec.markdown (in-memory state object)

[7] PREVIEW RENDERING
    "Preview" tab only:
      window.marked.parse(md) → raw HTML string
      window.DOMPurify.sanitize(html, allowlist) → sanitized HTML string
      previewPanel.innerHTML = safe  ← only point where doc-derived content
                                        reaches innerHTML; gated by DOMPurify

    "Raw Markdown" tab:
      rawPanel.textContent = md  ← safe, no HTML parsing

[8] COPY
    navigator.clipboard.writeText(rec.markdown) — writes Markdown text to
    the LOCAL OS clipboard. No network call. Falls back to deprecated
    document.execCommand('copy') if Clipboard API unavailable.

[9] DOWNLOAD
    new Blob([rec.markdown], { type: 'text/markdown' })
    URL.createObjectURL(blob) → blob: URL
    Programmatic <a>.click() triggers browser save dialog
    URL.revokeObjectURL(url) called immediately after click
    ZIP path: JSZip.generateAsync() → same Blob/URL pattern

[10] RESET / CLEANUP
    clearAllBtn: terminates all active workers, nulls rec.worker,
    clears state.files[], sets fileQueue/resultPanel/rawPanel/previewPanel
    to empty via innerHTML='' or textContent=''
    cancelOrRemove(): terminates individual worker, removes rec from state
    beforeunload: warns user if completed results exist, preventing accidental
    navigation away from unretrieved output
```

---

## Network requests that occur

| Request | Trigger | Content transmitted | Same-origin? |
|---|---|---|---|
| `/vendor/pdfjs/pdf.worker.mjs` | page load (pdf.js) | none | yes |
| `/vendor/tesseract/tesseract.esm.min.js` | first OCR conversion | none | yes |
| `/vendor/tesseract/worker.min.js` | first OCR conversion | none | yes |
| `/vendor/tesseract-core/worker.min.js` | first OCR conversion | none | yes |
| `/vendor/tesseract-core/tesseract-core-*.wasm` | first OCR conversion | none | yes |
| `/assets/tessdata/eng.traineddata` | first OCR conversion | none | yes |
| `/release-hash.json` | VERIFY button | none | yes |
| Each path in manifest | VERIFY button | none | yes |

No request carries file content, extracted text, OCR output, Markdown, or
document metadata. All fetches are to same-origin static assets.

---

## Where document-derived data exists in memory

| Location | Content | Cleared by |
|---|---|---|
| `state.files[i].file` | Original File object | cancelOrRemove() / clearAllBtn |
| `convertFile()` stack frame | ArrayBuffer (transient) | GC after function returns |
| pdf.js worker memory | Parsed PDF structure | pdf.js internal cleanup; worker terminates with process |
| Tesseract worker memory | Canvas blob, OCR result | finally block terminates worker |
| `state.files[i].markdown` | Generated Markdown | cancelOrRemove() / clearAllBtn |
| `rawPanel.textContent` | Markdown display copy | clearAllBtn (sets to '') |
| `previewPanel.innerHTML` | Sanitized HTML preview | clearAllBtn (sets to '') |
| OS clipboard | Markdown (after copy) | User-controlled; OS manages |
| Downloaded file | Markdown | User-controlled; on user's filesystem |

No document-derived data is written to localStorage, sessionStorage, IndexedDB,
Cache Storage, cookies, or service-worker caches.
