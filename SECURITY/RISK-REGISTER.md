# HeyMark Risk Register

**Date:** 2026-06-21
**Version:** 1.1.0
**Auditor:** Claude Code — Phase 2 (no code changes)

Risks are scored on two axes:
- **Likelihood:** 1 (rare) → 5 (near-certain)
- **Impact:** 1 (negligible) → 5 (critical — privacy breach or product-destroying)
- **Score:** Likelihood × Impact (max 25)

Risks are grouped by who can mitigate them: code changes, operational controls,
or inherent limitations that must be documented.

---

## Priority 1 — Mitigated by Phase 3 code changes

### RR-01 — Canvas memory exhaustion via oversized PDF page (T04)

| Field | Value |
|---|---|
| Threat | T04 |
| Finding | F-02 |
| Likelihood | 2 (possible with OCR mode; requires crafted or unusual PDF) |
| Impact | 4 (OOM crash; may affect other browser tabs; no data loss) |
| Score | **8** |
| Current residual | HIGH — no canvas pixel limit exists |
| Target residual after Phase 3 | LOW (limit enforced before canvas creation) |
| Owner | Oliver / Claude Code |
| Target phase | Phase 3 |

---

### RR-02 — OCR hang on adversarial or pathological image (T05)

| Field | Value |
|---|---|
| Threat | T05 |
| Finding | F-03 |
| Likelihood | 2 (requires unusual or crafted content) |
| Impact | 3 (hung UI; user must manually cancel; no data loss) |
| Score | **6** |
| Current residual | MEDIUM — no automatic timeout; user-discoverable |
| Target residual after Phase 3 | LOW (45-second per-page timeout + total deadline) |
| Owner | Oliver / Claude Code |
| Target phase | Phase 3 |

---

### RR-03 — Large document freezes preview renderer (T04 variant)

| Field | Value |
|---|---|
| Threat | T04 (output side) |
| Finding | F-04 |
| Likelihood | 2 (dense 2000-page document) |
| Impact | 3 (frozen tab; no data loss) |
| Score | **6** |
| Current residual | MEDIUM — no output size cap |
| Target residual after Phase 3 | LOW (output capped; preview tab removed) |
| Owner | Oliver / Claude Code |
| Target phase | Phase 3 |

---

### RR-04 — HTML injection via Preview tab (T06)

| Field | Value |
|---|---|
| Threat | T06 |
| Finding | Phase 1 audit |
| Likelihood | 1 (requires DOMPurify bypass + CSP bypass; very rare) |
| Impact | 4 (code execution in app origin) |
| Score | **4** |
| Current residual | LOW (DOMPurify + CSP defense-in-depth) |
| Target residual after Phase 3 | **ZERO** (preview tab removed; threat eliminated) |
| Owner | Oliver / Claude Code |
| Target phase | Phase 3 |

---

### RR-05 — Manifest releaseUrl HTML injection (T08)

| Field | Value |
|---|---|
| Threat | T08 |
| Finding | F-01 |
| Likelihood | 1 (requires hosting compromise) |
| Impact | 2 (script injection; blocked by CSP) |
| Score | **2** |
| Current residual | VERY LOW (CSP blocks inline script execution) |
| Target residual after Phase 3 | VERY LOW (DOM API removes the injection path entirely) |
| Owner | Oliver / Claude Code |
| Target phase | Phase 3 |

---

### RR-06 — User disclosure of document content via downstream AI tool (T21)

| Field | Value |
|---|---|
| Threat | T21 |
| Finding | Architecture |
| Likelihood | 5 (every user who copies and pastes to an AI tool takes this path) |
| Impact | 3 (depends on downstream tool's data practices; outside HeyMark's control) |
| Score | **15** |
| Current residual | HIGH — no advisory at copy/download; users may not understand the boundary |
| Target residual after Phase 3 | MEDIUM (advisory added at export; Phase 6 security page explains clearly) |
| Owner | Oliver — user education, security page |
| Target phase | Phase 3 (advisory), Phase 6 (documentation) |
| Note | This is the highest-scored risk in the register by score. It is inherent to the product's purpose — HeyMark converts documents so they CAN be pasted into AI tools. The mitigation is clear user communication, not technical prevention. |

---

## Priority 2 — Mitigated by Phase 5 operational controls

### RR-07 — Compromised GitHub account → production deployment (T10)

| Field | Value |
|---|---|
| Threat | T10 |
| Finding | Phase 2 analysis |
| Likelihood | 2 (MFA active; requires MFA bypass or session compromise) |
| Impact | 5 (full code replacement; all users affected) |
| Score | **10** |
| Current residual | MEDIUM — MFA reduces likelihood; no branch protection or PR gate |
| Target residual after Phase 5 | LOW (branch protection, token audit, deploy key review) |
| Owner | Oliver |
| Target phase | Phase 5 |

---

### RR-08 — Compromised Cloudflare Pages account (T11)

| Field | Value |
|---|---|
| Threat | T11 |
| Finding | Phase 2 analysis |
| Likelihood | 2 (MFA now active; requires MFA bypass or device compromise) |
| Impact | 5 (direct file modification; bypasses GitHub audit trail) |
| Score | **10** |
| Current residual | LOW — MFA confirmed 2026-06-21; sole account holder confirmed |
| Target residual after Phase 5 | LOW (access review documented, incident response drafted) |
| Owner | Oliver |
| Target phase | Phase 5 |
| **Resolved** | MFA enabled 2026-06-21. Oliver confirmed as sole account holder. |

---

### RR-09 — Compromised or stale vendored dependency (T09)

| Field | Value |
|---|---|
| Threat | T09 |
| Finding | F-06 (no SBOM, no update policy) |
| Likelihood | 2 (targeted supply chain attacks are rare; stale vendoring is moderate risk) |
| Impact | 5 (malicious code in vendor = full access to document content) |
| Score | **10** |
| Current residual | MEDIUM — vendoring prevents runtime CDN injection; no process for safe updates |
| Target residual after Phase 5 | LOW (SBOM, update policy, hash verification before deployment) |
| Owner | Oliver |
| Target phase | Phase 5 |

---

### RR-10 — Domain registrar hijack (T12)

| Field | Value |
|---|---|
| Threat | T12 |
| Finding | Phase 2 analysis |
| Likelihood | 1 (very rare; targeted attack) |
| Impact | 5 (complete traffic hijack; new users fully exposed) |
| Score | **5** |
| Current residual | LOW-MEDIUM (HSTS protects returning users; new users unprotected) |
| Target residual after Phase 5 | LOW (registrar lock + MFA + monitoring) |
| Owner | Oliver |
| Target phase | Phase 5 |

---

## Priority 3 — Inherent limitations (document in Phase 6)

### RR-11 — Browser extension access to document content (T15)

| Field | Value |
|---|---|
| Threat | T15 |
| Likelihood | 3 (many users have many extensions; extension supply chain attacks increasing) |
| Impact | 4 (silent exfiltration of document text) |
| Score | **12** |
| Residual risk | MEDIUM — inherent to browser architecture; no technical mitigation possible |
| Mitigation | Document on security page. Recommend dedicated/guest browser profile for sensitive documents. |
| Target phase | Phase 6 |

---

### RR-12 — Endpoint malware (T16)

| Field | Value |
|---|---|
| Threat | T16 |
| Likelihood | 3 (common enterprise threat) |
| Impact | 5 (complete bypass of all browser controls) |
| Score | **15** |
| Residual risk | HIGH — inherent; outside application scope entirely |
| Mitigation | Document on security page. HeyMark operates correctly on an uncompromised endpoint — endpoint security is the user's/IT's responsibility. |
| Target phase | Phase 6 |

---

### RR-13 — Integrity manifest replacement defeating VERIFY (T20)

| Field | Value |
|---|---|
| Threat | T20 |
| Likelihood | 1 (requires full hosting compromise + GitHub release notes access) |
| Impact | 4 (undermines the trust feature law firms rely on) |
| Score | **4** |
| Residual risk | LOW (two-step attack required; manifest hash published independently on GitHub) |
| Mitigation | Surface manifest hash in VERIFY UI; instruct users to compare against GitHub release. |
| Target phase | Phase 6 |

---

## Risk register summary

| ID | Title | Score | Phase | Status |
|---|---|---|---|---|
| RR-06 | Downstream AI tool disclosure | 15 | 3+6 | Open |
| RR-12 | Endpoint malware | 15 | 6 (inherent) | Open |
| RR-11 | Browser extension access | 12 | 6 (inherent) | Open |
| RR-07 | Compromised GitHub account | 10 | 5 | Open |
| RR-09 | Compromised vendored dependency | 10 | 5 | Open |
| RR-01 | Canvas memory exhaustion | 8 | 3 | Open |
| RR-02 | OCR hang / no timeout | 6 | 3 | Open |
| RR-03 | Large document output freeze | 6 | 3 | Open |
| RR-08 | Compromised Cloudflare account | 10 | 5 | **MFA confirmed 2026-06-21** |
| RR-10 | Domain registrar hijack | 5 | 5 | Open |
| RR-04 | HTML injection via preview | 4 | 3 | Open |
| RR-13 | Manifest replacement | 4 | 6 | Open |
| RR-05 | Manifest releaseUrl injection | 2 | 3 | Open |

---

## Approved Phase 3 target controls

The following controls are approved for implementation in Phase 3 based on this
risk register and Oliver's Phase 2 questionnaire answers:

1. Canvas pixel dimension limit (RR-01, F-02)
2. Per-page OCR timeout — 45 seconds (RR-02, F-03)
3. Total conversion timeout (RR-02)
4. Output size cap — 25M characters (RR-03, F-04)
5. Remove Preview tab — eliminates T06 entirely (RR-04)
6. Fix `releaseEl.innerHTML` — use DOM API + URL scheme validation (RR-05, F-01)
7. localStorage preference storage — with namespaced keys and value validation (T18)
8. 500-page soft warning (T03)
9. `loadingTask.destroy()` after each conversion (F-07)
10. Error message sanitization — no raw parser strings in UI (F-08)
11. URL scheme filter in Markdown output — strip `javascript:` and `data:text/html` (T07)
12. Download/copy advisory — one-time notice about downstream tool responsibility (RR-06, T21)
13. CSP meta tag / `_headers` sync (F-05)
14. SECURITY_LIMITS constant — single version-controlled configuration object

**Pre-Phase 3 blocker:** Cloudflare Pages MFA confirmed 2026-06-21 — blocker cleared. Phase 3 is approved to begin.
