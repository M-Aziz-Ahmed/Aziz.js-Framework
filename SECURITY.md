# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 3.2.x | Yes |
| Older | No — upgrade to the latest 3.2.x patch |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Open a private advisory at
**https://github.com/M-Aziz-Ahmed/Aziz.js-Framework/security/advisories/new**
with:

- the affected version and file/route,
- a minimal reproduction (a zip or a few files is ideal),
- impact and any known exploitation details,
- whether you want public credit.

You will receive an acknowledgement within **72 hours** and a status update
within **7 days**. If the report is valid we will:

1. Confirm the affected versions and severity (CVSS v3.1).
2. Prepare a fix on a private branch, with a regression test.
3. Publish a patched release and a GitHub Security Advisory.
4. Request a CVE through GitHub's CNA when the issue is in a released version
   and affects users who cannot simply upgrade a dependency.

Please give us **90 days** before public disclosure, or less if a fix ships
sooner. We will credit reporters unless asked otherwise.

## Scope

Aziz.js intentionally runs user modules with Node privileges. The following
are **not** vulnerabilities by themselves:

- `api/**`, `app/api/**`, `middleware.js`, `server/**` and `*.server.*` executing
  with filesystem/network access. That is the server runtime.
- A page importing a public module (`lib/`, `models/`, `components/`) and that
  module being downloadable. The security model treats these as public.
- The dev server serving source maps or unminified code.
- Missing rate limits, CSRF tokens or authentication in the scaffold. These are
  application responsibilities.

The following **are** in scope:

- reading files outside the project through static serving, image optimization,
  module resolution or the build pipeline;
- executing server-only modules (`server/`, `*.server.*`, `app/api/**`) in the
  browser;
- bypassing the edge-runtime `require()` boundary (`runtime = 'edge'`);
- HTML/attribute injection in the server renderer that escapes the page;
- request smuggling / header injection in the dev server;
- path traversal in SSG output or the ISR cache;
- dependency vulnerabilities in `@babel/standalone` that are exploitable
  through Aziz.js's transform path.

## Hardening checklist for apps

- Put secrets in environment variables, never in `lib/`, `models/` or
  `components/`.
- Put server-only code in `server/` or name files `*.server.js`.
- Use `runtime = 'edge'` for API routes that must not touch Node built-ins.
- Add authentication, authorization, CSRF protection and rate limiting in
  `middleware.js` or in each API route.
- Serve production behind a reverse proxy that sets TLS, request size limits
  and timeouts.
- Run `npm audit` and keep `@babel/standalone` current.
