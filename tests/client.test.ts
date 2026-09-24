import { afterEach, describe, expect, it, vi } from 'vitest';
import { AwesomeAuthClient } from '../src/client';
import { MemoryTokenStorage } from '../src/storage';
import { ALICE, UNAUTHORIZED, createFakeBackend } from './fakeBackend';

function clearCookies() {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

afterEach(clearCookies);

describe('session check', () => {
  it('stays loading until /me answers, then exposes the user', async () => {
    const be = createFakeBackend().on('GET /auth/me', { body: ALICE });
    const client = new AwesomeAuthClient({ fetch: be.fetch });
    expect(client.getSnapshot().isLoading).toBe(true);

    const user = await client.checkSession();

    expect(user).toEqual(ALICE);
    expect(client.getSnapshot()).toMatchObject({ user: ALICE, isAuthenticated: true, isLoading: false, error: null });
  });

  it('treats a 401 on /me as signed out after one refresh attempt', async () => {
    const be = createFakeBackend()
      .on('GET /auth/me', UNAUTHORIZED)
      .on('POST /auth/refresh', { status: 401, body: { error: 'No refresh token provided' } });
    const client = new AwesomeAuthClient({ fetch: be.fetch });
    const expired = vi.fn();
    client.on('sessionExpired', expired);

    expect(await client.checkSession()).toBeNull();

    expect(client.getSnapshot()).toMatchObject({ user: null, isAuthenticated: false, isLoading: false, error: null });
    expect(be.callsTo('POST /auth/refresh')).toHaveLength(1);
    expect(expired).not.toHaveBeenCalled(); // nobody was signed in
  });

  it('recovers an expired access token on reload: /me 401 → refresh → /me', async () => {
    const be = createFakeBackend()
      .on('GET /auth/me', UNAUTHORIZED, { body: ALICE })
      .on('POST /auth/refresh', { body: { success: true } });
    const client = new AwesomeAuthClient({ fetch: be.fetch });

    expect(await client.checkSession()).toEqual(ALICE);
    expect(be.callsTo('GET /auth/me')).toHaveLength(2);
  });

  it('shares one request between concurrent checks', async () => {
    const be = createFakeBackend().on('GET /auth/me', { body: ALICE });
    const client = new AwesomeAuthClient({ fetch: be.fetch });

    await Promise.all([client.checkSession(), client.checkSession(), client.checkSession()]);

    expect(be.callsTo('GET /auth/me')).toHaveLength(1);
  });

  it('a network failure on the first check stays loading (never reads as signed out)', async () => {
    let online = false;
    const be = createFakeBackend().on('GET /auth/me', { body: ALICE });
    const client = new AwesomeAuthClient({
      fetch: ((i: RequestInfo, init?: RequestInit) =>
        online ? be.fetch(i, init) : Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch,
    });

    await client.checkSession();
    expect(client.getSnapshot()).toMatchObject({ user: null, isLoading: true, error: 'Failed to fetch' });

    online = true;
    await client.checkSession();
    expect(client.getSnapshot()).toMatchObject({ user: ALICE, isLoading: false, error: null });
  });

  it('a network failure after sign-in keeps the user', async () => {
    let online = true;
    const be = createFakeBackend().on('GET /auth/me', { body: ALICE });
    const client = new AwesomeAuthClient({
      fetch: ((i: RequestInfo, init?: RequestInit) =>
        online ? be.fetch(i, init) : Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch,
    });
    await client.checkSession();

    online = false;
    await client.checkSession();

    expect(client.getSnapshot()).toMatchObject({ user: ALICE, isLoading: false, error: 'Failed to fetch' });
  });

  it('keeps the same snapshot and user reference when /me answers the same user', async () => {
    const be = createFakeBackend().on('GET /auth/me', { body: ALICE });
    const client = new AwesomeAuthClient({ fetch: be.fetch });
    await client.checkSession();
    const first = client.getSnapshot();
    const listener = vi.fn();
    client.subscribe(listener);

    await client.checkSession();

    expect(client.getSnapshot()).toBe(first);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('login', () => {
  it('logs in: POST /login, then /me, then notifies', async () => {
    const be = createFakeBackend()
      .on('GET /auth/me', UNAUTHORIZED, { body: ALICE })
      .on('POST /auth/refresh', UNAUTHORIZED)
      .on('POST /auth/login', { body: { success: true } });
    const client = new AwesomeAuthClient({ fetch: be.fetch });
    await client.checkSession();
    const changed = vi.fn();
    client.onAuthStateChanged(changed);

    const result = await client.login('alice@example.com', 'pw');

    expect(result).toEqual({ success: true });
    expect(be.callsTo('POST /auth/login')[0]?.body).toEqual({ email: 'alice@example.com', password: 'pw' });
    expect(client.getUser()).toEqual(ALICE);
    expect(changed).toHaveBeenCalledWith(ALICE);
  });

  it('does not let a stale startup check overwrite a later login', async () => {
    let releaseFirst!: () => void;
    const be = createFakeBackend()
      .on(
        'GET /auth/me',
        () => new Promise((resolve) => (releaseFirst = () => resolve(UNAUTHORIZED))),
        { body: ALICE },
      )
      .on('POST /auth/refresh', UNAUTHORIZED)
      .on('POST /auth/login', { body: { success: true } });
    const client = new AwesomeAuthClient({ fetch: be.fetch });

    const startup = client.checkSession();
    await client.login('alice@example.com', 'pw');
    releaseFirst();
    await startup;

    expect(client.getUser()).toEqual(ALICE);
  });

  it('returns the 2FA step-up without signing in', async () => {
    const be = createFakeBackend().on('POST /auth/login', {
      body: { requiresTwoFactor: true, tempToken: 'tmp_1', available2faMethods: ['totp', 'sms'] },
    });
    const client = new AwesomeAuthClient({ fetch: be.fetch });

    const result = await client.login('alice@example.com', 'pw');

    expect(result).toEqual({ success: true, requires2fa: true, tempToken: 'tmp_1', availableMethods: ['totp', 'sms'] });
    expect(client.getUser()).toBeNull();
    expect(be.callsTo('GET /auth/me')).toHaveLength(0);
  });

  it('completes the step-up with validate2fa (tempToken + totpCode)', async () => {
    const be = createFakeBackend()
      .on('POST /auth/2fa/verify', { body: { success: true } })
      .on('GET /auth/me', { body: ALICE });
    const client = new AwesomeAuthClient({ fetch: be.fetch });

    expect(await client.validate2fa('tmp_1', '123456')).toEqual({ success: true });
    expect(be.callsTo('POST /auth/2fa/verify')[0]?.body).toEqual({ tempToken: 'tmp_1', totpCode: '123456' });
    expect(client.getUser()).toEqual(ALICE);
  });

  it('maps the 403 "2FA setup required" answer', async () => {
    const be = createFakeBackend().on('POST /auth/login', {
      status: 403,
      body: { error: '2FA setup required', requires2FASetup: true, tempToken: 'tmp_setup' },
    });
    const client = new AwesomeAuthClient({ fetch: be.fetch });

    const result = await client.login('alice@example.com', 'pw');

    expect(result).toEqual({ success: false, requires2FASetup: true, tempToken: 'tmp_setup', error: '2FA setup required' });
    expect(be.callsTo('POST /auth/refresh')).toHaveLength(0);
  });

  it('reports bad credentials without refreshing', async () => {
    const be = createFakeBackend().on('POST /auth/login', { status: 401, body: { error: 'Invalid credentials' } });
    const client = new AwesomeAuthClient({ fetch: be.fetch });

    expect(await client.login('a@b.c', 'nope')).toEqual({ success: false, error: 'Invalid credentials' });
    expect(be.callsTo('POST /auth/refresh')).toHaveLength(0);
  });
});

describe('refresh and retry', () => {
  it('refreshes once for concurrent 401s and retries each request', async () => {
    const be = createFakeBackend()
      .on('GET /auth/sessions', UNAUTHORIZED, UNAUTHORIZED, { body: { sessions: [] } })
      .on('POST /auth/refresh', { body: { success: true } });
    const client = new AwesomeAuthClient({ fetch: be.fetch });
    const refreshed = vi.fn();
    client.on('refreshed', refreshed);

    const [a, b] = await Promise.all([client.getActiveSessions(), client.getActiveSessions()]);

    expect(a.success && b.success).toBe(true);
    expect(be.callsTo('POST /auth/refresh')).toHaveLength(1);
    expect(be.callsTo('GET /auth/sessions')).toHaveLength(4);
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it('SESSION_REVOKED clears the session without refreshing', async () => {
    const be = createFakeBackend()
      .on('GET /auth/me', { body: ALICE })
      .on('GET /auth/sessions', { status: 401, body: { error: 'Session has been revoked', code: 'SESSION_REVOKED' } });
    const client = new AwesomeAuthClient({ fetch: be.fetch });
    await client.checkSession();
    const expired = vi.fn();
    client.on('sessionExpired', expired);

    const result = await client.getActiveSessions();

    expect(result).toMatchObject({ success: false, code: 'SESSION_REVOKED' });
    expect(be.callsTo('POST /auth/refresh')).toHaveLength(0);
    expect(client.getUser()).toBeNull();
    expect(expired).toHaveBeenCalledWith({ reason: 'revoked' });
  });

  it('a revoked refresh (no success field) is a failure, not a retry', async () => {
    const be = createFakeBackend()
      .on('GET /auth/me', { body: ALICE })
      .on('GET /auth/sessions', UNAUTHORIZED)
      .on('POST /auth/refresh', { status: 401, body: { error: 'Session has been revoked', code: 'SESSION_REVOKED' } });
    const client = new AwesomeAuthClient({ fetch: be.fetch });
    await client.checkSession();
    const expired = vi.fn();
    client.on('sessionExpired', expired);

    await client.getActiveSessions();

    expect(be.callsTo('GET /auth/sessions')).toHaveLength(1);
    expect(client.getUser()).toBeNull();
    expect(expired).toHaveBeenCalledWith({ reason: 'revoked' });
  });

  it('a failed refresh signs the user out and emits sessionExpired', async () => {
    const be = createFakeBackend()
      .on('GET /auth/me', { body: ALICE })
      .on('GET /auth/sessions', UNAUTHORIZED)
      .on('POST /auth/refresh', UNAUTHORIZED);
    const client = new AwesomeAuthClient({ fetch: be.fetch });
    await client.checkSession();
    const expired = vi.fn();
    client.on('sessionExpired', expired);

    await client.getActiveSessions();

    expect(client.getUser()).toBeNull();
    expect(expired).toHaveBeenCalledWith({ reason: 'refresh-failed' });
  });
});

describe('cookie transport', () => {
  it('sends credentials and the CSRF cookie to the backend', async () => {
    document.cookie = '__Host-csrf-token=abc123; path=/';
    // jsdom refuses __Host- without Secure; fall back to the plain name as well.
    document.cookie = 'csrf-token=abc123; path=/';
    const be = createFakeBackend().on('POST /auth/logout', { body: { success: true } });
    const client = new AwesomeAuthClient({ fetch: be.fetch, mode: 'cookie' });

    await client.logout();

    const call = be.callsTo('POST /auth/logout')[0]!;
    expect(call.credentials).toBe('include');
    expect(call.headers.get('X-CSRF-Token')).toBe('abc123');
    expect(call.headers.has('X-Auth-Strategy')).toBe(false);
  });

  it('never attaches CSRF or credentials to another origin', async () => {
    document.cookie = 'csrf-token=abc123; path=/';
    const be = createFakeBackend().on('GET /data', { body: {} });
    const client = new AwesomeAuthClient({ fetch: be.fetch, mode: 'cookie' });

    await client.fetch('https://third-party.example/data');

    const call = be.calls[0]!;
    expect(call.headers.has('X-CSRF-Token')).toBe(false);
    expect(call.credentials).toBeUndefined();
  });

  it('client.fetch shares the refresh logic for app calls to the backend', async () => {
    const be = createFakeBackend()
      .on('GET /api/orders', UNAUTHORIZED, { body: [{ id: 1 }] })
      .on('POST /auth/refresh', { body: { success: true } });
    const client = new AwesomeAuthClient({ fetch: be.fetch, mode: 'cookie' });

    const res = await client.fetch('/api/orders');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 1 }]);
  });

  it('accepts an absolute cross-origin apiPrefix', async () => {
    const be = createFakeBackend('https://api.example.com').on('GET /auth/me', { body: ALICE });
    const client = new AwesomeAuthClient({ fetch: be.fetch, apiPrefix: 'https://api.example.com/auth/', mode: 'cookie' });

    await client.checkSession();

    expect(be.calls[0]?.url).toBe('https://api.example.com/auth/me');
    expect(be.calls[0]?.credentials).toBe('include');
  });
});

describe('bearer transport', () => {
  it('stores the tokens from login and sends them as Authorization', async () => {
    const storage = new MemoryTokenStorage();
    const be = createFakeBackend()
      .on('POST /auth/login', { body: { success: true, accessToken: 'at_1', refreshToken: 'rt_1' } })
      .on('GET /auth/me', { body: ALICE });
    const client = new AwesomeAuthClient({ fetch: be.fetch, mode: 'bearer', storage });

    expect(await client.login('alice@example.com', 'pw')).toEqual({ success: true });

    expect(storage.load()).toEqual({ accessToken: 'at_1', refreshToken: 'rt_1' });
    const login = be.callsTo('POST /auth/login')[0]!;
    expect(login.headers.get('X-Auth-Strategy')).toBe('bearer');
    const me = be.callsTo('GET /auth/me')[0]!;
    expect(me.headers.get('Authorization')).toBe('Bearer at_1');
    expect(me.headers.has('X-CSRF-Token')).toBe(false);
  });

  it('refreshes with the refresh token in the body and keeps the new pair', async () => {
    document.cookie = 'csrf-token=abc123; path=/';
    const storage = new MemoryTokenStorage();
    storage.save({ accessToken: 'at_old', refreshToken: 'rt_old' });
    const be = createFakeBackend()
      .on('GET /auth/me', UNAUTHORIZED, { body: ALICE })
      .on('POST /auth/refresh', { body: { success: true, accessToken: 'at_new', refreshToken: 'rt_new' } });
    const client = new AwesomeAuthClient({ fetch: be.fetch, mode: 'bearer', storage });

    expect(await client.checkSession()).toEqual(ALICE);

    const refresh = be.callsTo('POST /auth/refresh')[0]!;
    expect(refresh.body).toEqual({ refreshToken: 'rt_old' });
    expect(refresh.headers.has('X-CSRF-Token')).toBe(false);
    expect(be.callsTo('GET /auth/me')[1]?.headers.get('Authorization')).toBe('Bearer at_new');
    expect(storage.load()).toEqual({ accessToken: 'at_new', refreshToken: 'rt_new' });
  });

  it('skips /me entirely when no token is stored', async () => {
    const be = createFakeBackend();
    const client = new AwesomeAuthClient({ fetch: be.fetch, mode: 'bearer' });

    expect(await client.checkSession()).toBeNull();
    expect(be.calls).toHaveLength(0);
    expect(client.getSnapshot().isLoading).toBe(false);
  });

  it('works with an async storage (AsyncStorage-shaped)', async () => {
    let saved: string | null = JSON.stringify({ accessToken: 'at_1', refreshToken: 'rt_1' });
    const storage = {
      load: async () => (saved ? JSON.parse(saved) : null),
      save: async (t: unknown) => {
        saved = JSON.stringify(t);
      },
      clear: async () => {
        saved = null;
      },
    };
    const be = createFakeBackend()
      .on('GET /auth/me', { body: ALICE })
      .on('POST /auth/logout', { body: { success: true } });
    const client = new AwesomeAuthClient({ fetch: be.fetch, mode: 'bearer', storage });

    expect(await client.checkSession()).toEqual(ALICE);
    await client.logout();

    expect(saved).toBeNull();
    expect(client.getUser()).toBeNull();
  });

  it('never sends the bearer token to another origin', async () => {
    const storage = new MemoryTokenStorage();
    storage.save({ accessToken: 'at_1' });
    const be = createFakeBackend().on('GET /x', { body: {} });
    const client = new AwesomeAuthClient({ fetch: be.fetch, mode: 'bearer', storage });

    await client.fetch('https://evil.example/x');

    expect(be.calls[0]?.headers.has('Authorization')).toBe(false);
  });

  it('defaults to bearer on React Native and cookie elsewhere', () => {
    expect(new AwesomeAuthClient().mode).toBe('cookie');
    const spy = vi.spyOn(navigator, 'product', 'get').mockReturnValue('ReactNative');
    expect(new AwesomeAuthClient({ apiPrefix: 'https://api.example.com/auth' }).mode).toBe('bearer');
    expect(new AwesomeAuthClient({ mode: 'cookie' }).mode).toBe('cookie');
    spy.mockRestore();
  });
});

describe('logout and wire details', () => {
  it('logout clears state even when the backend errors, and emits logout', async () => {
    const be = createFakeBackend()
      .on('GET /auth/me', { body: ALICE })
      .on('POST /auth/logout', { status: 500, body: { error: 'boom' } });
    const client = new AwesomeAuthClient({ fetch: be.fetch });
    await client.checkSession();
    const onLogout = vi.fn();
    client.on('logout', onLogout);

    const result = await client.logout();

    expect(result).toEqual({ success: false, error: 'boom' });
    expect(client.getUser()).toBeNull();
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('uses the auth.js argument order and body names', async () => {
    const be = createFakeBackend()
      .on('POST /auth/reset-password', { body: { success: true } })
      .on('POST /auth/magic-link/send', { body: { success: true } })
      .on('POST /auth/sms/verify', { body: { success: true } })
      .on('GET /auth/me', { body: ALICE });
    const client = new AwesomeAuthClient({ fetch: be.fetch });

    await client.resetPassword('tok', 'new-pw');
    await client.send2faMagicLink('tmp_1');
    await client.validateSms('tmp_1', '4242');

    expect(be.callsTo('POST /auth/reset-password')[0]?.body).toEqual({ token: 'tok', password: 'new-pw' });
    expect(be.callsTo('POST /auth/magic-link/send')[0]?.body).toEqual({ tempToken: 'tmp_1', mode: '2fa' });
    expect(be.callsTo('POST /auth/sms/verify')[0]?.body).toEqual({ tempToken: 'tmp_1', code: '4242', mode: '2fa' });
  });

  it('encodes path segments and query values', async () => {
    const be = createFakeBackend()
      .on('DELETE /auth/sessions/a%2Fb', { body: { success: true } })
      .on('GET /auth/verify-email', { body: { success: true } })
      .on('GET /auth/me', { body: ALICE });
    const client = new AwesomeAuthClient({ fetch: be.fetch });

    expect(await client.revokeSession('a/b')).toEqual({ success: true });
    await client.verifyEmail('x&y=z');

    expect(be.callsTo('GET /auth/verify-email')[0]?.url).toContain('token=x%26y%3Dz');
    expect(client.oauthUrl('google')).toBe('/auth/oauth/google');
  });
});

describe('review fixes', () => {
  it('a refresh in flight when logout starts cannot bring the session back (bearer)', async () => {
    const storage = new MemoryTokenStorage();
    storage.save({ accessToken: 'at_old', refreshToken: 'rt_old' });
    let releaseRefresh!: () => void;
    const be = createFakeBackend()
      .on('GET /auth/me', { body: ALICE })
      .on('GET /auth/sessions', UNAUTHORIZED)
      .on('POST /auth/refresh', () =>
        new Promise((resolve) => {
          releaseRefresh = () => resolve({ body: { success: true, accessToken: 'at_new', refreshToken: 'rt_new' } });
        }),
      )
      .on('POST /auth/logout', { body: { success: true } });
    const client = new AwesomeAuthClient({ fetch: be.fetch, mode: 'bearer', storage });
    await client.checkSession();

    const pending = client.getActiveSessions(); // 401 → refresh, held open
    await vi.waitFor(() => expect(be.callsTo('POST /auth/refresh')).toHaveLength(1));
    const loggingOut = client.logout();
    releaseRefresh();
    await Promise.all([pending, loggingOut]);

    expect(client.getUser()).toBeNull();
    expect(storage.load()).toBeNull();
    // Logout waited for the refresh, so it revoked the newest refresh token.
    expect(be.callsTo('POST /auth/logout')[0]?.body).toEqual({ refreshToken: 'rt_new' });
  });

  it('bearer logout hands the refresh token to the backend', async () => {
    const storage = new MemoryTokenStorage();
    storage.save({ accessToken: 'at_1', refreshToken: 'rt_1' });
    const be = createFakeBackend().on('POST /auth/logout', { body: { success: true } });
    const client = new AwesomeAuthClient({ fetch: be.fetch, mode: 'bearer', storage });

    await client.logout();

    const call = be.callsTo('POST /auth/logout')[0]!;
    expect(call.body).toEqual({ refreshToken: 'rt_1' });
    expect(call.headers.get('Authorization')).toBe('Bearer at_1');
  });

  it('does not refresh on a coded input error (CSRF_INVALID)', async () => {
    const be = createFakeBackend()
      .on('GET /auth/me', { body: ALICE })
      .on('POST /auth/change-email/request', { status: 403, body: { error: 'CSRF token validation failed', code: 'CSRF_INVALID' } });
    const client = new AwesomeAuthClient({ fetch: be.fetch });
    await client.checkSession();

    const result = await client.requestEmailChange('new@example.com');

    expect(result).toEqual({ success: false, error: 'CSRF token validation failed', code: 'CSRF_INVALID' });
    expect(be.callsTo('POST /auth/refresh')).toHaveLength(0);
    expect(client.getUser()).toEqual(ALICE);
  });

  it('still refreshes on INVALID_TOKEN and on the bare 403 of an expired access token', async () => {
    const be = createFakeBackend()
      .on('GET /auth/linked-accounts',
        { status: 401, body: { error: 'Invalid or expired access token', code: 'INVALID_TOKEN' } },
        { body: { linkedAccounts: [] } },
        { status: 403, body: { error: 'Invalid or expired access token' } },
        { body: { linkedAccounts: [] } })
      .on('POST /auth/refresh', { body: { success: true } });
    const client = new AwesomeAuthClient({ fetch: be.fetch });

    expect((await client.getLinkedAccounts()).success).toBe(true);
    expect((await client.getLinkedAccounts()).success).toBe(true);
    expect(be.callsTo('POST /auth/refresh')).toHaveLength(2);
  });

  it('a wrong SMS code is not resubmitted', async () => {
    const be = createFakeBackend().on('POST /auth/sms/verify', { status: 401, body: { error: 'Invalid or expired SMS code' } });
    const client = new AwesomeAuthClient({ fetch: be.fetch });

    expect(await client.validateSms('tmp_1', '0000')).toEqual({ success: false, error: 'Invalid or expired SMS code' });
    expect(be.callsTo('POST /auth/sms/verify')).toHaveLength(1);
    expect(be.callsTo('POST /auth/refresh')).toHaveLength(0);
  });
});
