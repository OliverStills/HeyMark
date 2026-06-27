# HeyMark — Subprocessors

**Version:** 1.1.0
**Date:** 2026-06-27

---

## Subprocessor statement

HeyMark processes no document content on any server. All PDF parsing, OCR,
structure reconstruction, and Markdown generation run locally in the user's
browser. No subprocessor receives, handles, or has access to document content,
extracted text, OCR output, or generated Markdown.

The table below lists the infrastructure providers involved in delivering the
HeyMark application. These providers deliver static files only. None of them
receive document-derived data.

---

## Infrastructure providers

| Provider | Role | Data received | Document content received? |
|---|---|---|---|
| Cloudflare Pages | Static file CDN and hosting | IP address, request metadata (path, user-agent, timestamp, response code) | **No** |
| GitHub | Source code hosting, CI/CD | Source code only | **No** |

---

## Subprocessors that handle document content

**None.** Document content never leaves the browser.

---

## Updates

If HeyMark were to add a subprocessor that handles document content, this document
would be updated and users notified prior to the change taking effect. Such a
change would require breaking the core zero-transmission architecture and would
be treated as a major version change requiring explicit opt-in.

---

## Contact

Questions about subprocessors: oliver.sandoval312@gmail.com
