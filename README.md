# @awesome-lang-auth/react

React bindings for the **awesome-\*-auth** family: one provider, one hook, two gates, and a small typed client that speaks the awesome-node-auth wire protocol directly.

It works with any backend of the family, because they all serve the same protocol: awesome-node-auth, awesome-go-auth, awesome-lambda-auth, and the python, rust and dart ports. It depends on none of them, only on `react`.

- **Cookie on the web, bearer on React Native.** The transport is picked for you and can be overridden.
- **No global patching.** The served `auth.js` replaces `window.fetch`. This package never does: app calls that need the session go through `client.fetch`.
- **React 18 and 19.** State is read with `useSyncExternalStore`, so there are no tearing and no extra re-renders.
- **SSR-safe.** Server renders see `isLoading: true`. The entry carries `'use client'` for the Next.js App Router.
- **Router-agnostic gates.** `<ProtectedRoute>` and `<AnonymousOnly>` render; you decide how to navigate.

```bash
npm install @awesome-lang-auth/react
```

## Quick start

```tsx
import { useState } from 'react';
import { AwesomeAuthProvider, ProtectedRoute, AnonymousOnly, useAwesomeAuth } from '@awesome-lang-auth/react';

export function App() {
  return (
    <AwesomeAuthProvider options={{ apiPrefix: '/auth' }}>
      <AnonymousOnly fallback={null}>
        <LoginForm />
      </AnonymousOnly>
      <ProtectedRoute fallback={<Spinner />} redirectTo="/login">
        <Dashboard />
      </ProtectedRoute>
    </AwesomeAuthProvider>
  );
}

function LoginForm() {
  const { login } = useAwesomeAuth();
  const [step, setStep] = useState<{ tempToken: string } | null>(null);

  async function onSubmit(email: string, password: string) {
    const r = await login(email, password);
    if (r.requires2fa) setStep({ tempToken: r.tempToken! }); // then client.validate2fa(tempToken, code)
    else if (!r.success) alert(r.error);
  }
  // ...
}

function Dashboard() {
  const { user, logout } = useAwesomeAuth();
  return <button onClick={logout}>Sign out {user?.email}</button>;
}
```

`apiPrefix` is where the backend mounts its auth router: `/auth` by default, or an absolute URL such as `https://api.example.com/auth` when the backend is on another origin.

## The client

`AwesomeAuthClient` is framework-free. Create one yourself to share it with non-React code (an API layer, a store), then hand it to the provider:

```ts
import { AwesomeAuthClient } from '@awesome-lang-auth/react';

export const auth = new AwesomeAuthClient({ apiPrefix: 'https://api.example.com/auth' });

// Authenticated app calls: credentials attached, one refresh-and-retry on 401/403.
const res = await auth.fetch('https://api.example.com/orders');

auth.on('sessionExpired', () => router.navigate('/login'));
auth.onAuthStateChanged((user) => console.log('user is now', user));
```

```tsx
<AwesomeAuthProvider client={auth}>...</AwesomeAuthProvider>
```

Every method resolves to `{ success, error?, code? }` (plus its payload) and **never rejects on an HTTP error**, like the served `auth.js` and ng-awesome-node-auth.

| Area | Methods |
| --- | --- |
| Session | `checkSession`, `refresh`, `logout`, `getActiveSessions`, `revokeSession`, `fetch`, `oauthUrl(provider)` |
| Login | `login(email, password)`, `register(email, password, firstName?, lastName?)`, `updateProfile` |
| Password | `forgotPassword`, `resetPassword(token, password)`, `changePassword`, `setPassword` |
| Magic link | `sendMagicLink`, `verifyMagicLink`, `send2faMagicLink(tempToken)` |
| SMS | `sendSmsLogin`, `verifySmsLogin`, `send2faSms(tempToken)`, `validateSms(tempToken, code)`, `addPhone` |
| 2FA | `setup2fa`, `verify2faSetup(code, secret)`, `validate2fa(tempToken, code)`, `disable2fa` |
| Email | `resendVerificationEmail`, `verifyEmail`, `requestEmailChange`, `confirmEmailChange` |
| Linking | `requestLinkingEmail`, `verifyLinkingToken`, `verifyConflictLinkingToken`, `getLinkedAccounts`, `unlinkAccount` |
| Account | `deleteAccount` |

**Login with a second factor.** When the account has 2FA, `login` resolves to `{ success: true, requires2fa: true, tempToken, availableMethods }` and the user stays signed out. Complete it with `validate2fa(tempToken, code)` (TOTP), `send2faSms` + `validateSms`, or `send2faMagicLink`. When the account must enrol first, the backend answers 403 and `login` resolves to `{ success: false, requires2FASetup: true, tempToken }`.

**Argument order.** `resetPassword(token, password)` follows the served `auth.js`. ng-awesome-node-auth has the order reversed.

**The user** is the `GET /me` payload. Its id is `sub`, not `id`. It also has `email`, `role`, `loginProvider`, `isEmailVerified` and `isTotpEnabled`, plus `metadata`, `roles` and `permissions` when the backend has those stores. Type your own claims with `useAuthUser<MyUser>()`.

## Transport: cookie or bearer

| | `cookie` (web default) | `bearer` (React Native default) |
| --- | --- | --- |
| Tokens | HttpOnly cookies set by the backend | JSON body, kept in a `TokenStorage` |
| Requests | `credentials: 'include'` + `X-CSRF-Token` from the CSRF cookie | `X-Auth-Strategy: bearer` + `Authorization: Bearer` |
| Refresh | `POST /refresh` (cookie) | `POST /refresh` with `{ refreshToken }` |

Credentials, CSRF tokens and bearer tokens are attached **only to requests for the backend's origin**. A `client.fetch` to any other origin goes out untouched.

Override the default with `mode`:

```ts
new AwesomeAuthClient({ apiPrefix: 'https://api.example.com/auth', mode: 'bearer', storage });
```

Bearer tokens live in memory by default, so the session ends when the app does. To persist them on React Native, pass a storage. Sync and async methods both work:

```ts
import * as SecureStore from 'expo-secure-store';
import type { TokenStorage } from '@awesome-lang-auth/react';

const storage: TokenStorage = {
  load: async () => JSON.parse((await SecureStore.getItemAsync('auth')) ?? 'null'),
  save: (t) => SecureStore.setItemAsync('auth', JSON.stringify(t)),
  clear: () => SecureStore.deleteItemAsync('auth'),
};
```

On React Native, `apiPrefix` must be an absolute URL.

## Gates

```tsx
<ProtectedRoute
  fallback={<Spinner />}          // while loading, and while leaving
  redirectTo="/login"             // full-page navigation for signed-out visitors
  onUnauthenticated={() => nav('/login')} // or drive your router (wins over redirectTo)
  role={['admin', 'editor']}      // optional: user.role or user.roles
  forbidden={<p>No access</p>}    // signed in without the role
>
  <Admin />
</ProtectedRoute>

<AnonymousOnly fallback={null} onAuthenticated={() => nav('/')}>
  <LoginForm />
</AnonymousOnly>
```

**React Router.** Pass `onUnauthenticated={() => navigate('/login', { replace: true })}`, using `navigate` from `useNavigate()`. You can also branch on `useAwesomeAuth().isAuthenticated` and render `<Navigate>` yourself.

**Next.js App Router.** The package entry is marked `'use client'`, so you can render `<AwesomeAuthProvider>` from your root layout. For server-side gating, check the session cookie in middleware. This package covers the client side.

## SSR

On the server the provider renders with `{ user: null, isAuthenticated: false, isLoading: true }`. That is also the state React hydrates against, so there is no mismatch. The session check starts in the browser after hydration. Nothing reads `window` or `document` at import time.

## Not in this package (yet)

- The admin console API and the AuthTools SSE stream.
- An adapter for a page that already loads the served `auth.js` (`window.AwesomeNodeAuth`). Use one or the other: `auth.js` patches the global `fetch`.

## Develop

Node is not required on the host. `scripts/toolchain.sh` runs `node:22` in Docker, with `node_modules` in a named volume:

```bash
./scripts/toolchain.sh npm ci
./scripts/toolchain.sh npm test
./scripts/toolchain.sh npm run build
./scripts/toolchain.sh npm run lint:package
```

## License

MIT
