# HeyMark — Dependency Update Policy

## Principles

- All runtime dependencies are manually vendored. No CDN or runtime npm fetch.
- Updates are deliberate, reviewed, and tied to a release.
- A dependency is updated when a security fix is available or the current version
  has a confirmed vulnerability, not on a rolling schedule.
- No dependency is updated without running the full test suite against the new version.

---

## Trigger conditions

Update a dependency when any of the following is true:

1. A CVE is published against the vendored version.
2. The upstream project publishes a security advisory.
3. GitHub Dependabot or secret scanning raises an alert (when enabled).
4. A manual review identifies a risk not covered by an existing CVE.
5. A planned minor/major version upgrade is approved by Oliver.

---

## Update procedure

For each dependency update:

**Step 1 — Verify the upstream release**
- Download the release artifact from the upstream GitHub releases page.
- Confirm the release is signed or that the published SHA-256 matches.
- Read the changelog / release notes for breaking changes or new privilege requirements.

**Step 2 — Replace the vendored file(s)**
- Copy the new file(s) into the appropriate `vendor/<lib>/` directory.
- Do not rename files without updating all references in `app.js` and `index.html`.

**Step 3 — Test**
```bash
node --check app.js          # syntax check
npm test                     # full test suite (121 checks + Playwright)
```
All tests must pass. Investigate and resolve any failure before proceeding.

**Step 4 — Regenerate the integrity manifest**
```bash
node build-hashes.mjs
```
Note the printed manifest SHA-256. This is published in the release notes.

**Step 5 — Update SBOM**
In `SECURITY/SBOM.md`, update:
- `Version`
- `SHA-256 hashes`
- `Last reviewed` date
- `Known CVEs` (mark the fixed CVE as resolved)

**Step 6 — Commit and release**
Follow `SECURITY/RELEASE-PROCESS.md`. Tag the release.
Include the new manifest SHA-256 in the release notes.

---

## Dependency-specific notes

### pdf.js
- Check releases at: https://github.com/mozilla/pdf.js/releases
- The `pdf.mjs` and `pdf.worker.mjs` files must be from the same release and same
  build. Mixing versions will cause worker handshake failures.
- After update, manually test conversion of a multi-page text PDF and a scanned PDF.

### Tesseract.js
- Check releases at: https://github.com/naptha/tesseract.js/releases
- Files across `vendor/tesseract/` and `vendor/tesseract-core/` must be from the
  same release. The WASM files are duplicated between directories by design.
- After update, manually test OCR mode with a scanned PDF.
- Check whether `wasm-unsafe-eval` is still required; remove from CSP if not.

### JSZip
- Check releases at: https://github.com/Stuk/jszip/releases
- After update, test multi-file zip download.

---

## Exceptions

If a known vulnerability cannot be immediately remediated (e.g., upstream fix not
yet released), document the exception with:
- CVE or advisory ID
- Risk assessment
- Mitigating controls
- Owner (Oliver)
- Target remediation date

Exceptions must not remain open longer than 90 days without a new review.
