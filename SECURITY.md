# HeyMark — Security

## Reporting a vulnerability

Please do not open a public GitHub issue for security vulnerabilities.

Report privately through GitHub's security advisory system:  
**https://github.com/OliverStills/HeyMark/security/advisories/new**

Or email: oliver.sandoval312@gmail.com (subject: `[HeyMark Security]`)

We acknowledge reports within 48 hours and follow a 90-day coordinated
disclosure window. Full policy: [SECURITY/VULNERABILITY-DISCLOSURE.md](SECURITY/VULNERABILITY-DISCLOSURE.md)

---

## Security overview

HeyMark is a browser-only PDF-to-Markdown converter. All processing is local.
No document content is transmitted to any server.

Core guarantees:
- Zero server-side processing of document content
- Content Security Policy blocks all third-party connections at the browser level
- All runtime libraries are vendored and self-hosted (no CDN)
- 121 automated security tests run on every commit
- Per-file SHA-256 integrity manifest published with every release

Full documentation:
- [Security controls](SECURITY/SECURITY-CONTROLS.md)
- [Architecture](SECURITY/ARCHITECTURE.md)
- [Known limitations](SECURITY/KNOWN-LIMITATIONS.md)
- [Dependency inventory (SBOM)](SECURITY/SBOM.md)
- [Procurement overview](SECURITY/PROCUREMENT-OVERVIEW.md)

Public security page: [heymark.io/security](https://www.heymark.io/security)

---

## Supported versions

| Version | Security support |
|---|---|
| 1.1.0 | Current — supported |
| 1.0.0 | Superseded — upgrade recommended |
