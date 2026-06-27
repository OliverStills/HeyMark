# HeyMark — Known Limitations

**Version:** 1.1.0
**Date:** 2026-06-27

HeyMark's privacy guarantees are bounded by the browser environment. The
following limitations are inherent to the local-processing model and are
documented here for accurate evaluation by users and procurement reviewers.

---

## L-01 — Browser extensions

Browser extensions can access the content of any web page in the browser, including
HeyMark's converted Markdown. Content scripts run at the same privilege level as the
page and can read the DOM, intercept clipboard operations, and observe network
traffic.

**Implication:** If a user's browser has extensions installed (ad blockers, password
managers, grammar checkers, screen readers, productivity tools), those extensions
may be able to observe document content during conversion. HeyMark's Cross-Origin
policies reduce cross-origin window access but do not prevent content scripts.

**Mitigation:** Use a browser profile with no extensions for sensitive document
conversion. Verify installed extensions come from trusted publishers.

---

## L-02 — Compromised endpoint

If the device running HeyMark is compromised (malware, keylogger, screen capture
tool, remote access software), an attacker can observe document content before it
reaches HeyMark, during processing, or after conversion.

**Implication:** HeyMark's local-processing guarantee assumes a trusted browser
running on a trusted OS. Endpoint security is outside HeyMark's control.

**Mitigation:** Use HeyMark on a managed, patched device with endpoint protection.

---

## L-03 — Downstream tool exposure

HeyMark outputs Markdown. Once the user copies or downloads that Markdown,
it is no longer under HeyMark's control. If the user pastes it into a cloud-based
tool (email, cloud editor, AI assistant, collaboration platform), that tool's
privacy policy governs what happens to the content.

**Implication:** HeyMark's zero-transmission guarantee applies only while the
document is being processed. Post-export handling is entirely the user's responsibility.

**Mitigation:** Use HeyMark's "Copy to clipboard" only with tools approved for
the sensitivity of the document. HeyMark displays a warning on copy for scanned
documents.

---

## L-04 — Clipboard access by other applications

Clipboard content on most operating systems can be accessed by any application
with focus, and on some platforms by any application at all. After copying Markdown
from HeyMark, it persists in the system clipboard until replaced.

**Implication:** Other applications on the same device may read the Markdown from
the clipboard.

**Mitigation:** Clear the clipboard after pasting (most password managers and
clipboard tools have a clear function).

---

## L-05 — Hosting provider (Cloudflare Pages)

HeyMark's static files are delivered by Cloudflare Pages. Cloudflare does not
receive document content (all processing is local), but Cloudflare does receive:
- IP address of the visitor
- HTTP request metadata (path, user-agent, timestamp)

This is standard for any web application delivered via a CDN. No document content,
extracted text, or generated Markdown is ever present in a request that Cloudflare
sees.

See `SECURITY/SUBPROCESSORS.md`.

---

## L-06 — Browser-level bugs

HeyMark relies on the browser's implementation of the Web Platform (SharedArrayBuffer,
WebAssembly, SubtleCrypto, the Web Workers API, the Canvas API). A zero-day
vulnerability in the browser itself could allow an attacker to bypass sandbox
protections. HeyMark cannot mitigate browser-engine vulnerabilities.

**Mitigation:** Keep the browser updated. HeyMark is tested on current stable
Chrome/Chromium and is expected to work on current Firefox and Safari.

---

## L-07 — No access controls or audit log

HeyMark has no user accounts, no authentication, and no audit trail. Anyone with
access to a device where HeyMark is open can use it. There is no log of which
documents were converted, when, or by whom.

**Implication:** This is a feature (privacy) but is also a limitation for
organizations that require audit trails of document access. HeyMark is not a
substitute for a DMS or DLP system.

---

## L-08 — OCR accuracy

Scanned PDF conversion uses Tesseract.js, an open-source OCR engine. OCR accuracy
depends on scan quality, resolution, font type, and document condition. Low-quality
scans may produce partial or inaccurate text. HeyMark marks low-confidence OCR
pages with a warning blockquote in the output.

**Implication:** OCR output from scanned documents should be reviewed before use
in legal proceedings.

---

## L-09 — PDF complexity

Some complex PDF layouts (multi-column text, embedded forms, complex graphics with
text overlap, right-to-left scripts, CJK characters, non-standard font encodings)
may not convert accurately. HeyMark is optimized for English-language legal
documents in standard layouts.

**Implication:** Conversion quality should be verified for each document type before
relying on the output.

---

## L-10 — No penetration test conducted

HeyMark has not been independently penetration tested. The security controls
described in `SECURITY/SECURITY-CONTROLS.md` are self-assessed and backed by
automated tests but have not been validated by a third-party security firm.

**Status:** On the roadmap for a future release.
