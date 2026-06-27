# HeyMark — Procurement Overview

**Version:** 1.1.0
**Date:** 2026-06-27
**For:** Law firm IT and risk reviewers

---

## What HeyMark does

HeyMark converts PDF documents to Markdown format. It is designed for legal
professionals who need to extract and reformat document text for use in
downstream workflows (drafting tools, AI assistants, document management systems).

---

## Architecture summary

HeyMark is a static web application with no server-side processing.

- **Processing location:** The user's browser (local device only)
- **Server role:** Deliver static files (HTML, JavaScript, fonts, libraries)
- **Document handling:** The PDF is never uploaded to any server

All PDF parsing, text extraction, OCR, and Markdown generation run in the
browser using the Web Platform APIs (Web Workers, WebAssembly, Canvas API).

---

## Data flow summary

```
User's PDF → Browser memory → PDF parser (local) → Markdown string (local) → User's clipboard or downloaded file
```

At no step does document content reach any server, network connection, or
third-party service.

---

## Privacy statement

> **Your document is processed locally in your browser. HeyMark does not
> transmit the document or extracted content to our servers.**

This is not a marketing claim — it is an architectural fact enforced by:
1. No server-side application logic exists.
2. The browser's Content Security Policy (`connect-src 'self' blob:`) blocks
   all connections to third-party origins at the browser level, independently of
   application code.
3. Automated Playwright tests intercept every network request during a full
   conversion cycle and fail if any request leaves the local origin.

---

## What Cloudflare sees

HeyMark is hosted on Cloudflare Pages (static file CDN). Cloudflare receives:
- Visitor IP address
- HTTP request metadata (path, timestamp, user-agent)

Cloudflare does **not** receive:
- PDF content
- Extracted text
- OCR output
- Generated Markdown
- Any document-derived data

No document content is ever present in an HTTP request — because all processing
is local.

---

## Security controls summary

| Control | Implementation | Tested? |
|---|---|---|
| Zero server-side processing | Static app, no backend | Playwright zero-egress test |
| Content Security Policy | `default-src 'none'; connect-src 'self' blob:` | Automated CSP check |
| HTTPS + HSTS | 2-year HSTS + preload list | Production header check |
| Cross-origin isolation | COOP + COEP + CORP | Production header check |
| File format validation | Magic-byte check before parsing | Fixture tests |
| Resource limits | 50 MB file, 500 pages, 40 MP canvas, 60 s timeout | Unit tests |
| No DOM injection | `textContent` only for document content | Static analysis (121 checks) |
| URL sanitization | `javascript:`, `data:text/html` stripped from output | Unit tests |
| Worker isolation + cleanup | Workers terminated; object URLs revoked | Playwright storage test |
| Dependency pinning | All libraries vendored at exact versions | SBOM + static analysis |
| Integrity verification | Per-file SHA-256 manifest + VERIFY button | Manual per-release |
| Automated CI | 121 tests on every push to main | GitHub Actions |

Full details: `SECURITY/SECURITY-CONTROLS.md`

---

## Dependency inventory

| Library | Version | License | Purpose |
|---|---|---|---|
| pdf.js | 4.10.38 | Apache-2.0 | PDF parsing and text extraction |
| Tesseract.js | 5.1.1 | Apache-2.0 | In-browser OCR for scanned PDFs |
| JSZip | 3.10.1 | MIT | ZIP packaging for multi-file downloads |

All libraries are self-hosted (`vendor/`). No CDN. No runtime npm.
Full inventory with SHA-256 hashes: `SECURITY/SBOM.md`

---

## Known limitations

| Limitation | Description |
|---|---|
| Browser extensions | Extensions may observe page content (use a profile without extensions for sensitive docs) |
| Endpoint compromise | Malware on the device can observe content before/after HeyMark processes it |
| Downstream tools | Once Markdown is copied or downloaded, its handling is the user's responsibility |
| No audit log | No user accounts, no access log — HeyMark holds no user data |
| No penetration test | Security controls are self-assessed; third-party pen test not yet conducted |
| OCR accuracy | Scanned PDFs subject to OCR quality limitations; review output before use |

Full details: `SECURITY/KNOWN-LIMITATIONS.md`

---

## Subprocessors

No subprocessor receives document content. The only infrastructure provider is
Cloudflare Pages (static file delivery). Full statement: `SECURITY/SUBPROCESSORS.md`

---

## Incident response

A documented incident response plan covers:
- How to disable the site
- Credential revocation and rotation procedures
- Severity classification (P0–P3)
- Security advisory publication
- Post-incident review

Full plan: `SECURITY/INCIDENT-RESPONSE.md`

---

## Vulnerability reporting

Private disclosure: https://github.com/OliverStills/HeyMark/security/advisories/new  
Email: oliver.sandoval312@gmail.com  
90-day coordinated disclosure window.  
Full policy: `SECURITY/VULNERABILITY-DISCLOSURE.md`

---

## Release integrity

Every release publishes a SHA-256 manifest covering all runtime files. Users can
verify the deployed code matches the published source by clicking VERIFY in the
app footer. The manifest's own hash is published in the GitHub release notes.

---

## What we do not claim

HeyMark does **not** claim to be:
- SOC 2 compliant (not audited)
- Independently certified
- Suitable for all document sensitivity levels without IT review
- A replacement for a DMS, DLP system, or document review platform

---

## Contact

Oliver Sandoval — oliver.sandoval312@gmail.com  
Security reports: https://github.com/OliverStills/HeyMark/security/advisories/new
