# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0]

### Added
- `AwesomeAuthClient`: typed, framework-free client for the awesome-node-auth
  wire protocol. Covers session, login with 2FA step-up, password, magic link,
  SMS, TOTP, email verification and change, account linking and deletion.
  Every call resolves to a result object and never rejects on HTTP errors.
- Cookie transport (web default): `credentials: 'include'` and the
  `X-CSRF-Token` double-submit header, sent to the backend origin only.
- Bearer transport (React Native default): `X-Auth-Strategy: bearer`, tokens
  kept in a pluggable `TokenStorage`, and refresh with `{ refreshToken }`.
- One shared refresh-and-retry on 401/403, with `SESSION_REVOKED` short-circuit
  and a `sessionExpired` event. `client.fetch` shares it without patching the
  global `fetch`.
- `AwesomeAuthProvider` built on `useSyncExternalStore` (React 18 and 19),
  plus `useAwesomeAuth`, `useAuthUser`, `useAuthClient`.
- `ProtectedRoute` (with `role`) and `AnonymousOnly` gates, router-agnostic.
- SSR: server renders see `isLoading: true`; the entry is marked `'use client'`.
- Dual ESM/CJS build with type declarations for both.
