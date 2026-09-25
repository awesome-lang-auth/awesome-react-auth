# Contributing to awesome-react-auth

Thank you for your interest in contributing to `@awesome-lang-auth/react`, the React client of the awesome-*-auth family.

## Development setup

You need Node 20 or later.

```bash
git clone https://github.com/awesome-lang-auth/awesome-react-auth
cd awesome-react-auth
npm ci
npm test            # vitest
npm run typecheck
npm run build       # tsup: ESM + CJS + types
```

Without Node on the host, `./scripts/toolchain.sh npm test` runs the same commands in a `node:22` container.

## How to contribute

1. **Fork** the repository and create a branch from `main`.
2. Keep the change focused, and follow the existing code style.
3. Add or update tests. They run against a fake backend at the wire level (`tests/fakeBackend.ts`), so assert on real request and response shapes.
4. Make sure `npm run typecheck`, `npm test` and `npm run build` pass.
5. Note user-facing changes under `[Unreleased]` in `CHANGELOG.md`.
6. Open a **pull request** against `main`. Use [Conventional Commits](https://www.conventionalcommits.org) for the title (`feat:`, `fix:`, `docs:`, …).

## Wire compatibility

The client has to work unchanged against every backend of the family. Endpoint paths, body fields and response handling follow the reference, [awesome-node-auth](https://github.com/nik2208/awesome-node-auth). A change in the protocol belongs there first.

## Reporting bugs and requesting features

Use the [issue templates](.github/ISSUE_TEMPLATE/), and search the existing issues before you open a new one.

## Security issues

Do **not** open a public issue for a security vulnerability. [SECURITY.md](SECURITY.md) describes how to report one privately.

## Code of Conduct

All contributors are expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your work is licensed under the [MIT License](LICENSE) that covers this project.
