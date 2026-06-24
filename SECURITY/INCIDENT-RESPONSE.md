# HeyMark — Incident Response Plan

## Scope

This plan covers security incidents affecting the HeyMark application, its
deployment, or its users. It does not cover incidents that are solely within
a user's own device or browser (outside HeyMark's threat boundary).

---

## Severity levels

| Level | Definition | Response time |
|---|---|---|
| P0 — Critical | Active exploitation, confirmed egress of document content, compromised deployment, credential exposure | Immediate (within 1 hour) |
| P1 — High | Unpatched CVE in a runtime dependency, CSP bypass, integrity-manifest tampering | Within 24 hours |
| P2 — Medium | Vulnerability in unused vendored code, misconfigured header, minor privacy claim inaccuracy | Within 7 days |
| P3 — Low | Documentation gap, non-exploitable finding | Next planned release |

---

## Detection sources

- User report (github.com/oliverstills/heymark/security/advisories)
- GitHub Dependabot / secret scanning alert
- Manual security review
- Self-discovery during development

---

## Immediate response (P0 / P1)

### 1. Disable the site (if active exploitation is suspected)

In the Cloudflare Pages dashboard:
- Go to Pages → HeyMark → Settings → General
- Set "Access Policy" to restrict all traffic, or
- Deploy a maintenance page that serves only a static notice

Do not delete the deployment — preserve it for forensic review.

### 2. Revoke compromised credentials

If a deployment credential, GitHub token, or Cloudflare API key is compromised:

**GitHub:**
- Settings → Developer settings → Personal access tokens → Revoke the affected token
- Review recent Actions runs for unauthorized activity
- Check commits for unexpected author names or email addresses

**Cloudflare Pages:**
- Cloudflare dashboard → My Profile → API Tokens → Revoke the affected token
- Review deployment history for unauthorized deployments
- Check Pages project settings for unauthorized collaborators

**Domain registrar:**
- Log in and rotate the account password immediately
- Revoke any API access tokens for the domain
- Check DNS records for unauthorized changes (especially A/CNAME/NS records)

### 3. Rotate credentials after revocation

Generate new credentials for each revoked item. Use the minimum necessary scope.
Store new credentials in a password manager. Enable or confirm MFA is active.

---

## Investigation

### Identify affected releases

```bash
# Find commits that modified a specific file
git log --oneline -- app.js

# Find the first commit that introduced a vulnerability
git log --oneline --all | head -20

# Check what changed between two versions
git diff v1.0.0 v1.1.0 -- app.js
```

The integrity manifest (`release-hash.json`) + the published manifest SHA-256 in
each GitHub release allows verifying whether the deployed files match the published
source. If the manifest SHA-256 does not match, the deployment was tampered with.

### Preserve evidence

Preserve the following WITHOUT collecting user document content:
- The deployed file hashes (run `node build-hashes.mjs` against a local copy)
- Cloudflare Pages deployment logs (timestamp, commit hash, triggered by)
- GitHub Actions run logs
- Any network-level indicators of compromise (not application traffic — HeyMark
  processes no server-side data)

Do not collect, retain, or share:
- Any user-uploaded PDF files
- Any extracted text, OCR output, or generated Markdown
- Any user-identifying information

---

## Publish a security advisory

For P0 and P1 incidents affecting users:

1. Go to github.com/oliverstills/heymark/security/advisories
2. Click "New draft security advisory"
3. Complete: severity, affected version(s), description, patched version
4. Do not publish until a patched release is available
5. Coordinate disclosure: allow 90 days from discovery for a fix before public disclosure
   (standard responsible disclosure window)

Advisory must state clearly:
- What the vulnerability was
- Whether user document content could have been exposed (zero-egress architecture
  means server-side exposure is not possible, but client-side attacks may vary)
- What users should do (e.g., reload the page, which pulls the patched version)

---

## Restore a known-good release

```bash
# Identify the last known-good tag
git tag -l | sort -V | tail -10

# Check out that tag
git checkout v1.0.0

# Verify integrity of that version
node build-hashes.mjs
# Compare the printed hash to the hash published in the v1.0.0 GitHub release notes
```

In Cloudflare Pages, use the Deployments tab to roll back to a specific deployment
by commit hash. Confirm the rollback by checking the version string in the app footer.

---

## Post-incident review

Within 7 days of resolution:

1. Document the timeline: when detected, when contained, when resolved
2. Root cause: what failed (code, process, access control, dependency)
3. Impact: what could have been accessed, by whom, for how long
4. Fixes applied: code changes, credential rotations, policy updates
5. Prevention: what process change prevents recurrence
6. Update `SECURITY/FINDINGS.md` and `SECURITY/RISK-REGISTER.md`
7. If a runtime dependency was the vector, update `SECURITY/SBOM.md`

---

## Contact

Security reports: github.com/oliverstills/heymark/security/advisories (private)
Owner: Oliver Sandoval — oliver.sandoval312@gmail.com
