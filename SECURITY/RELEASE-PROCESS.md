# HeyMark — Release Process

## Pre-release checklist

Before cutting any release, confirm every item:

- [ ] All tests pass: `npm test`
- [ ] `node --check app.js` passes
- [ ] `node build-hashes.mjs` has been run and `release-hash.json` is up to date
- [ ] `SECURITY/SBOM.md` versions and hashes match the vendored files
- [ ] `index.html` version string matches the release tag (`v1.x.x`)
- [ ] Footer version string in `index.html` matches
- [ ] `build-hashes.mjs` VERSION and RELEASE_URL constants match the new tag
- [ ] No unresolved security findings in `SECURITY/FINDINGS.md`
- [ ] Manual test of core conversion paths (text PDF, scanned PDF with OCR)
- [ ] VERIFY button in the live app shows all files matched after deploy

---

## Steps

**1. Update version references**

In `index.html` (two places: `<title>` / `<p>` in footer):
```
HeyMark — PDF to Markdown Converter
HEYMARK · v1.x.x · ALL PROCESSING IS LOCAL
```

In `build-hashes.mjs`:
```js
const VERSION = '1.x.x';
const RELEASE_URL = 'https://github.com/OliverStills/HeyMark/releases/tag/v1.x.x';
```

**2. Regenerate the integrity manifest**
```bash
node build-hashes.mjs
```
Note the printed manifest SHA-256. You will paste this into the release notes.

**3. Run the full test suite**
```bash
npm test
```
All 121+ checks must pass.

**4. Commit**
```bash
git add -A
git commit -m "release: v1.x.x"
```

**5. Tag**
```bash
git tag v1.x.x
git push origin main --tags
```

**6. Create GitHub release**
- Title: `v1.x.x`
- Body must include:
  - Summary of changes
  - Manifest SHA-256: `<hash from build-hashes.mjs>`
  - Instructions: "To verify integrity, click VERIFY in the app footer and compare
    the COMPUTED hash to the manifest SHA-256 published here."

**7. Verify the deployment**
After Cloudflare Pages auto-deploys:
- Open `https://www.heymark.io`
- Click VERIFY in the footer
- Confirm STATUS shows all files matched
- Confirm RELEASE shows the correct version and release URL

---

## Rollback

If a broken release reaches production:

1. Identify the last known-good commit hash: `git log --oneline`
2. In Cloudflare Pages dashboard → Deployments, roll back to the previous deployment
3. Confirm the rollback is live by checking the version string in the footer
4. Investigate the root cause before cutting a new release
5. Document the incident in `SECURITY/INCIDENT-RESPONSE.md`

---

## Hotfix releases

For security fixes:
- Branch from the affected tag: `git checkout -b hotfix/v1.x.1 v1.x.0`
- Apply the minimum necessary fix
- Run `npm test` and `node build-hashes.mjs`
- Merge to `main`, tag, and release
- Do not bundle unrelated changes into a security hotfix
