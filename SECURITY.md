# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x (latest) | ✅ |
| older | ❌ |

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Report it privately through a [GitHub Security Advisory](https://github.com/awesome-lang-auth/awesome-react-auth/security/advisories/new).

Please include:

- a description of the vulnerability and its impact;
- steps to reproduce, or a proof of concept;
- the affected versions;
- a suggested fix, if you have one.

## Response timeline

- **Acknowledgement:** within 48 hours.
- **Assessment and triage:** within 5 business days.
- **Fix and advisory:** published once a patched release is on npm.

## Scope

This policy covers this package: the client, its token handling, and the React bindings.

A vulnerability in the protocol, or in how a backend issues and validates tokens, belongs to the backend. Report it to that backend's repository, for example the [awesome-node-auth security policy](https://github.com/nik2208/awesome-node-auth/blob/main/SECURITY.md).

## Supply chain

- Releases are published from GitHub Actions with npm trusted publishing (OIDC). No npm token exists, and every release from 0.1.1 onward carries an npm provenance attestation. Check it with `npm audit signatures`.
- Every third-party action is pinned to a full commit SHA and updated by Dependabot.
- The package has no runtime dependencies. `react` and `react-dom` are peer dependencies.
