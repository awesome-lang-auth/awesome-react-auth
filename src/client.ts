import { MemoryTokenStorage } from './storage';
import {
  CSRF_HEADER,
  STRATEGY_HEADER,
  detectDefaultMode,
  isBackendUrl,
  isNoRetryEndpoint,
  normalizePrefix,
  readCsrfToken,
} from './transport';
import type {
  AuthClientOptions,
  AuthEventMap,
  AuthEventName,
  AuthResult,
  AuthState,
  AuthTransportMode,
  AuthUser,
  LinkedAccountsResult,
  LoginResult,
  RegisterResult,
  SessionsResult,
  StoredTokens,
  TokenStorage,
  TwoFactorSetupResult,
} from './types';

type Listener = () => void;
type EventHandler<T> = (payload: T) => void;
type RefreshOutcome = 'ok' | 'failed' | 'revoked';

/** Parsed answer of one backend call. `status` is 0 on a network failure. */
interface ApiResponse {
  ok: boolean;
  status: number;
  // The wire bodies are loosely typed JSON; each method narrows what it reads.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  networkError?: string;
}

/** The code node and go put on a 401 that a refresh can cure (resource-server verification). */
const TOKEN_ERROR_CODES = new Set(['INVALID_TOKEN']);

const INITIAL_STATE: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
};

async function readJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function sameUser(a: AuthUser | null, b: AuthUser | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function isUser(value: unknown): value is AuthUser {
  return typeof value === 'object' && value !== null && typeof (value as AuthUser).sub === 'string';
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Browser/React Native client for the awesome-node-auth wire protocol.
 *
 * It speaks the protocol directly with `fetch` and never patches the global
 * `fetch`: backend calls made by the app go through {@link AwesomeAuthClient.fetch}
 * when they should share the refresh-and-retry logic. It is framework-free;
 * the React bindings read it through {@link subscribe} / {@link getSnapshot},
 * the `useSyncExternalStore` contract.
 *
 * Every method resolves to a result object and never rejects on an HTTP error,
 * like the served `auth.js` and ng-awesome-node-auth.
 */
export class AwesomeAuthClient<TUser extends AuthUser = AuthUser> {
  readonly apiPrefix: string;
  readonly mode: AuthTransportMode;

  private readonly storage: TokenStorage;
  private readonly fetchImpl: typeof fetch | undefined;

  private state: AuthState<TUser> = INITIAL_STATE as AuthState<TUser>;
  private readonly listeners = new Set<Listener>();
  // Keyed by event name; `on` and `emit` keep each set's payload type aligned.
  private readonly handlers = new Map<AuthEventName, Set<EventHandler<never>>>();

  /** Bearer tokens: `undefined` until first read from storage. */
  private tokens: StoredTokens | null | undefined = undefined;
  private sessionCheck: Promise<TUser | null> | null = null;
  /** Bumped by every session check and by logout; stale checks never commit. */
  private checkGeneration = 0;
  private refreshing: Promise<RefreshOutcome> | null = null;
  /**
   * Bumped whenever the user changes. A request that fails with an expired
   * session only clears the state if nobody signed in or out since it left:
   * a slow request from before a login must not log the new session out.
   */
  private userEpoch = 0;
  /** Bumped by logout and account deletion; a refresh that spans one is dropped. */
  private sessionGeneration = 0;

  constructor(options: AuthClientOptions = {}) {
    this.apiPrefix = normalizePrefix(options.apiPrefix ?? '/auth');
    this.mode = options.mode ?? detectDefaultMode();
    this.storage = options.storage ?? new MemoryTokenStorage();
    this.fetchImpl = options.fetch;
  }

  // ── Store contract (useSyncExternalStore) ──────────────────────────────

  /** Registers a state listener; returns the unsubscribe function. */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Current state. The reference changes only when the state does. */
  getSnapshot = (): AuthState<TUser> => this.state;

  getUser(): TUser | null {
    return this.state.user;
  }

  isAuthenticated(): boolean {
    return this.state.isAuthenticated;
  }

  /** `true` once the first session check has settled. */
  isInitialized(): boolean {
    return !this.state.isLoading;
  }

  // ── Events ─────────────────────────────────────────────────────────────

  on<K extends AuthEventName>(event: K, handler: EventHandler<AuthEventMap<TUser>[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    const entry = handler as EventHandler<never>;
    set.add(entry);
    return () => {
      set.delete(entry);
    };
  }

  /** Calls `callback` with the new user whenever it changes. */
  onAuthStateChanged(callback: (user: TUser | null) => void): () => void {
    return this.on('change', callback);
  }

  private emit<K extends AuthEventName>(event: K, payload: AuthEventMap<TUser>[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        (handler as EventHandler<AuthEventMap<TUser>[K]>)(payload);
      } catch (err) {
        console.error(`[awesome-react-auth] "${event}" handler threw`, err);
      }
    }
  }

  private setState(patch: Partial<AuthState<TUser>>): void {
    const prev = this.state;
    const user = 'user' in patch ? (sameUser(prev.user, patch.user ?? null) ? prev.user : (patch.user ?? null)) : prev.user;
    const next: AuthState<TUser> = {
      user,
      isAuthenticated: user !== null,
      isLoading: patch.isLoading ?? prev.isLoading,
      error: 'error' in patch ? (patch.error ?? null) : prev.error,
    };
    if (
      next.user === prev.user &&
      next.isLoading === prev.isLoading &&
      next.error === prev.error
    ) {
      return;
    }
    this.state = next;
    if (next.user !== prev.user) this.userEpoch++;
    for (const listener of [...this.listeners]) listener();
    if (next.user !== prev.user) this.emit('change', next.user);
  }

  // ── Transport ──────────────────────────────────────────────────────────

  private resolveFetch(): typeof fetch {
    if (this.fetchImpl) return this.fetchImpl;
    if (typeof fetch !== 'function') {
      throw new Error('[awesome-react-auth] no global fetch: pass options.fetch');
    }
    return fetch;
  }

  private async loadTokens(): Promise<StoredTokens | null> {
    if (this.tokens === undefined) {
      try {
        this.tokens = (await this.storage.load()) ?? null;
      } catch {
        this.tokens = null;
      }
    }
    return this.tokens;
  }

  private async saveTokens(tokens: StoredTokens): Promise<void> {
    this.tokens = tokens;
    try {
      await this.storage.save(tokens);
    } catch (err) {
      console.error('[awesome-react-auth] token storage save failed', err);
    }
  }

  private async clearTokens(): Promise<void> {
    if (this.mode !== 'bearer') return;
    this.tokens = null;
    try {
      await this.storage.clear();
    } catch (err) {
      console.error('[awesome-react-auth] token storage clear failed', err);
    }
  }

  /** Bearer mode: keeps the tokens a login/refresh/verify answer carries. */
  private async captureTokens(data: unknown): Promise<void> {
    if (this.mode !== 'bearer' || typeof data !== 'object' || data === null) return;
    const { accessToken, refreshToken } = data as Partial<StoredTokens>;
    if (typeof accessToken !== 'string' || accessToken === '') return;
    const previous = await this.loadTokens();
    await this.saveTokens({
      accessToken,
      refreshToken: typeof refreshToken === 'string' ? refreshToken : previous?.refreshToken,
    });
  }

  /** One request, with the transport's credentials when it targets the backend. */
  private async attempt(input: RequestInfo | URL, init: RequestInit | undefined, backend: boolean): Promise<Response> {
    const isRequest = typeof Request !== 'undefined' && input instanceof Request;
    const headers = new Headers(isRequest ? (input as Request).headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const finalInit: RequestInit = { ...init, headers };

    if (backend) {
      if (this.mode === 'cookie') {
        finalInit.credentials = init?.credentials ?? 'include';
        const csrf = readCsrfToken();
        if (csrf && !headers.has(CSRF_HEADER)) headers.set(CSRF_HEADER, csrf);
      } else {
        headers.set(STRATEGY_HEADER, 'bearer');
        const tokens = await this.loadTokens();
        if (tokens?.accessToken && !headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${tokens.accessToken}`);
        }
      }
    }

    // A Request body can be read once: every attempt sends its own clone.
    const target = isRequest ? (input as Request).clone() : input;
    return this.resolveFetch()(target, finalInit);
  }

  /**
   * Sends a request; on a 401/403 from a backend endpoint that is not itself
   * an auth answer, refreshes once (shared with concurrent callers) and
   * retries once. `SESSION_REVOKED` skips the refresh.
   */
  private async send(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = urlOf(input);
    const backend = isBackendUrl(url, this.apiPrefix);
    const epoch = this.userEpoch;
    const response = await this.attempt(input, init, backend);

    if (!backend || (response.status !== 401 && response.status !== 403) || isNoRetryEndpoint(url, this.apiPrefix)) {
      return response;
    }

    const body = (await readJson(response.clone())) as { code?: string } | null;
    if (body?.code === 'SESSION_REVOKED') {
      if (epoch === this.userEpoch) await this.expire('revoked');
      return response;
    }
    // An expired access token comes back with no code (node answers a bare
    // 403) or a token code. Any other code (CSRF_INVALID, INVALID_TEMP_TOKEN,
    // TOKEN_MISMATCH, ...) is an answer about the input: refreshing cannot fix
    // it, and retrying would resend a code or a password.
    if (typeof body?.code === 'string' && !TOKEN_ERROR_CODES.has(body.code)) return response;

    const outcome = await this.refreshSession();
    if (outcome === 'ok') return this.attempt(input, init, backend);
    if (epoch === this.userEpoch) await this.expire(outcome === 'revoked' ? 'revoked' : 'refresh-failed');
    return response;
  }

  /** Clears the session after a failed refresh; announces it if a user was signed in. */
  private async expire(reason: 'refresh-failed' | 'revoked'): Promise<void> {
    const hadUser = this.state.user !== null;
    await this.clearTokens();
    this.setState({ user: null });
    if (hadUser) this.emit('sessionExpired', { reason });
  }

  private refreshSession(): Promise<RefreshOutcome> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<RefreshOutcome> {
    // A logout while the refresh is in flight wins: its answer is discarded.
    const generation = this.sessionGeneration;
    let body: Record<string, string> = {};
    if (this.mode === 'bearer') {
      const tokens = await this.loadTokens();
      if (!tokens?.refreshToken) return 'failed';
      body = { refreshToken: tokens.refreshToken };
    }
    let response: Response;
    try {
      response = await this.attempt(
        `${this.apiPrefix}/refresh`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) },
        true,
      );
    } catch {
      return 'failed';
    }
    const data = (await readJson(response)) as { code?: string; success?: boolean } | null;
    if (generation !== this.sessionGeneration) return 'failed';
    // A revoked refresh has no `success` field: check the code first.
    if (data?.code === 'SESSION_REVOKED') return 'revoked';
    if (!response.ok || data?.success === false) return 'failed';
    await this.captureTokens(data);
    this.emit('refreshed', undefined);
    return 'ok';
  }

  private async api(method: string, path: string, body?: unknown): Promise<ApiResponse> {
    const init: RequestInit = { method, headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      init.headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    let response: Response;
    try {
      response = await this.send(`${this.apiPrefix}${path}`, init);
    } catch (err) {
      return { ok: false, status: 0, data: null, networkError: err instanceof Error ? err.message : 'Network error' };
    }
    const data = await readJson(response);
    await this.captureTokens(data);
    return { ok: response.ok, status: response.status, data };
  }

  private fail(r: ApiResponse, fallback: string): AuthResult {
    const result: AuthResult = { success: false, error: r.data?.error ?? r.networkError ?? fallback };
    if (typeof r.data?.code === 'string') result.code = r.data.code;
    return result;
  }

  private done(r: ApiResponse, fallback: string): AuthResult {
    return r.ok && r.data?.success !== false ? { success: true } : this.fail(r, fallback);
  }

  /** For calls that open or change the session: on success, re-read `/me`. */
  private async doneAndRecheck(r: ApiResponse, fallback: string): Promise<AuthResult> {
    const result = this.done(r, fallback);
    if (result.success) await this.startCheck();
    return result;
  }

  // ── Public fetch ───────────────────────────────────────────────────────

  /**
   * `fetch` with the session attached. Requests to the backend origin get the
   * transport's credentials (cookie + CSRF, or bearer token) and one
   * refresh-and-retry on 401/403; requests to any other origin go out
   * untouched. The global `fetch` is never modified.
   */
  fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => this.send(input, init);

  /** URL of the OAuth entry point for `provider`, for a full-page navigation. */
  oauthUrl(provider: string): string {
    return `${this.apiPrefix}/oauth/${encodeURIComponent(provider)}`;
  }

  // ── Session ────────────────────────────────────────────────────────────

  /**
   * Reads `GET /me` and updates the state. Concurrent calls share one request.
   * Resolves to the user, or `null` when there is no session.
   */
  checkSession(): Promise<TUser | null> {
    return this.sessionCheck ?? this.startCheck();
  }

  /** Starts a fresh check that supersedes any one in flight. */
  private startCheck(): Promise<TUser | null> {
    const generation = ++this.checkGeneration;
    const promise = this.doCheck(generation).finally(() => {
      if (this.sessionCheck === promise) this.sessionCheck = null;
    });
    this.sessionCheck = promise;
    return promise;
  }

  private async doCheck(generation: number): Promise<TUser | null> {
    if (this.mode === 'bearer' && !(await this.loadTokens())) {
      if (generation === this.checkGeneration) this.setState({ user: null, isLoading: false, error: null });
      return this.state.user;
    }
    const r = await this.api('GET', '/me');
    if (generation !== this.checkGeneration) return this.state.user;

    if (r.ok && isUser(r.data)) {
      this.setState({ user: r.data as TUser, isLoading: false, error: null });
    } else if (r.status === 0) {
      // Network failure proves nothing about the session: keep what we knew
      // (and stay loading if we knew nothing, so the gates do not bounce a
      // valid session to the login page). Call checkSession() again to retry.
      this.setState({ error: r.networkError ?? 'Network error' });
    } else if (r.status === 401 || r.status === 403) {
      this.setState({ user: null, isLoading: false, error: null });
    } else {
      this.setState({
        user: null,
        isLoading: false,
        error: r.data?.error ?? `Session check failed (HTTP ${r.status})`,
      });
    }
    return this.state.user;
  }

  /** Refreshes the tokens now. Concurrent calls share one request. */
  async refresh(): Promise<AuthResult> {
    const outcome = await this.refreshSession();
    if (outcome === 'ok') return { success: true };
    await this.expire(outcome === 'revoked' ? 'revoked' : 'refresh-failed');
    return outcome === 'revoked'
      ? { success: false, error: 'Session has been revoked', code: 'SESSION_REVOKED' }
      : { success: false, error: 'Refresh failed' };
  }

  /**
   * Ends the session. The local state is cleared whatever the backend answers,
   * and no navigation happens: redirect from your own code or `logout` event.
   */
  async logout(): Promise<AuthResult> {
    this.checkGeneration++; // a check still in flight must not resurrect the user
    this.sessionCheck = null;
    // Let a refresh in flight land first, so its Set-Cookie cannot arrive after
    // the logout cleared the cookies; then make sure its answer is dropped.
    if (this.refreshing) await this.refreshing.catch(() => undefined);
    this.sessionGeneration++;
    // Bearer: hand the refresh token over so the backend can revoke it (go
    // reads it from the body; node only revokes from the access-token cookie).
    const tokens = this.mode === 'bearer' ? await this.loadTokens() : null;
    const r = await this.api('POST', '/logout', tokens?.refreshToken ? { refreshToken: tokens.refreshToken } : {});
    await this.clearTokens();
    this.setState({ user: null, isLoading: false, error: null });
    this.emit('logout', undefined);
    return this.done(r, 'Logout failed');
  }

  async getActiveSessions(): Promise<SessionsResult> {
    const r = await this.api('GET', '/sessions');
    if (!r.ok) return { ...this.fail(r, 'Failed to load sessions'), sessions: [] };
    return { success: true, sessions: Array.isArray(r.data?.sessions) ? r.data.sessions : [] };
  }

  async revokeSession(sessionHandle: string): Promise<AuthResult> {
    return this.done(await this.api('DELETE', `/sessions/${encodeURIComponent(sessionHandle)}`), 'Failed to revoke session');
  }

  // ── Auth ───────────────────────────────────────────────────────────────

  /**
   * Password login. With a second factor enrolled it resolves to
   * `{ success: true, requires2fa: true, tempToken, availableMethods }` and the
   * user stays signed out until {@link validate2fa} / {@link validateSms}.
   */
  async login(email: string, password: string): Promise<LoginResult> {
    const r = await this.api('POST', '/login', { email, password });
    const d = r.data ?? {};
    if (d.requires2FASetup) {
      return { success: false, requires2FASetup: true, tempToken: d.tempToken, error: d.error ?? '2FA setup required' };
    }
    if (!r.ok) return this.fail(r, 'Login failed');
    if (d.requiresTwoFactor) {
      return {
        success: true,
        requires2fa: true,
        tempToken: d.tempToken,
        availableMethods: Array.isArray(d.available2faMethods) ? d.available2faMethods : [],
      };
    }
    if (d.success === false) return this.fail(r, 'Login failed');
    const user = await this.startCheck();
    return user ? { success: true } : { success: false, error: this.state.error ?? 'Session could not be established' };
  }

  /** Creates an account. The backends open a session on success. */
  async register(email: string, password: string, firstName?: string, lastName?: string): Promise<RegisterResult> {
    const r = await this.api('POST', '/register', { email, password, firstName, lastName });
    if (!r.ok || r.data?.success === false) return this.fail(r, 'Registration failed');
    await this.startCheck();
    const result: RegisterResult = { success: true };
    if (typeof r.data?.userId === 'string') result.userId = r.data.userId;
    return result;
  }

  async updateProfile(firstName: string, lastName: string): Promise<AuthResult> {
    return this.doneAndRecheck(await this.api('PATCH', '/profile', { firstName, lastName }), 'Update failed');
  }

  // ── Password ───────────────────────────────────────────────────────────

  async forgotPassword(email: string): Promise<AuthResult> {
    return this.done(await this.api('POST', '/forgot-password', { email }), 'Failed to send recovery email');
  }

  /** Argument order of the served `auth.js`: token first (ng has it reversed). */
  async resetPassword(token: string, password: string): Promise<AuthResult> {
    return this.done(await this.api('POST', '/reset-password', { token, password }), 'Failed to reset password');
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<AuthResult> {
    return this.doneAndRecheck(
      await this.api('POST', '/change-password', { currentPassword, newPassword }),
      'Failed to change password',
    );
  }

  /** First password for an account created through OAuth or a magic link. */
  async setPassword(newPassword: string): Promise<AuthResult> {
    return this.changePassword('', newPassword);
  }

  // ── Magic link ─────────────────────────────────────────────────────────

  async sendMagicLink(email: string): Promise<AuthResult> {
    return this.done(await this.api('POST', '/magic-link/send', { email, mode: 'login' }), 'Failed to send magic link');
  }

  async verifyMagicLink(token: string): Promise<AuthResult> {
    return this.doneAndRecheck(await this.api('POST', '/magic-link/verify', { token, mode: 'login' }), 'Verification failed');
  }

  /** Second factor by magic link, after a login that answered `requires2fa`. */
  async send2faMagicLink(tempToken: string): Promise<AuthResult> {
    return this.done(await this.api('POST', '/magic-link/send', { tempToken, mode: '2fa' }), 'Failed to send magic link');
  }

  // ── SMS ────────────────────────────────────────────────────────────────

  async sendSmsLogin(email: string): Promise<AuthResult> {
    return this.done(await this.api('POST', '/sms/send', { email, mode: 'login' }), 'Failed to send SMS');
  }

  async verifySmsLogin(userId: string, code: string): Promise<AuthResult> {
    return this.doneAndRecheck(await this.api('POST', '/sms/verify', { userId, code, mode: 'login' }), 'Invalid SMS code');
  }

  async send2faSms(tempToken: string): Promise<AuthResult> {
    return this.done(await this.api('POST', '/sms/send', { tempToken, mode: '2fa' }), 'Failed to send SMS');
  }

  async validateSms(tempToken: string, code: string): Promise<AuthResult> {
    return this.doneAndRecheck(await this.api('POST', '/sms/verify', { tempToken, code, mode: '2fa' }), 'Invalid SMS code');
  }

  async addPhone(phoneNumber: string): Promise<AuthResult> {
    return this.done(await this.api('POST', '/add-phone', { phoneNumber }), 'Failed to add phone number');
  }

  // ── 2FA ────────────────────────────────────────────────────────────────

  async setup2fa(): Promise<TwoFactorSetupResult> {
    const r = await this.api('POST', '/2fa/setup', {});
    if (!r.ok) return this.fail(r, 'Failed to initialize 2FA');
    return { success: true, secret: r.data?.secret, qrCode: r.data?.qrCode };
  }

  async verify2faSetup(code: string, secret: string): Promise<AuthResult> {
    return this.doneAndRecheck(await this.api('POST', '/2fa/verify-setup', { token: code, secret }), 'Failed to verify 2FA code');
  }

  /** Completes a login that answered `requires2fa`, with a TOTP code. */
  async validate2fa(tempToken: string, code: string): Promise<AuthResult> {
    return this.doneAndRecheck(await this.api('POST', '/2fa/verify', { tempToken, totpCode: code }), 'Invalid 2FA code');
  }

  async disable2fa(): Promise<AuthResult> {
    return this.doneAndRecheck(await this.api('POST', '/2fa/disable', {}), 'Failed to disable 2FA');
  }

  // ── Email ──────────────────────────────────────────────────────────────

  async resendVerificationEmail(): Promise<AuthResult> {
    return this.done(await this.api('POST', '/send-verification-email', {}), 'Failed to resend verification email');
  }

  async verifyEmail(token: string): Promise<AuthResult> {
    return this.doneAndRecheck(
      await this.api('GET', `/verify-email?token=${encodeURIComponent(token)}`),
      'Verification failed',
    );
  }

  async requestEmailChange(newEmail: string): Promise<AuthResult> {
    return this.done(await this.api('POST', '/change-email/request', { newEmail }), 'Failed to request email change');
  }

  async confirmEmailChange(token: string): Promise<AuthResult> {
    return this.doneAndRecheck(await this.api('POST', '/change-email/confirm', { token }), 'Failed to confirm email change');
  }

  // ── Account linking ────────────────────────────────────────────────────

  async requestLinkingEmail(email: string, provider: string): Promise<AuthResult> {
    return this.done(await this.api('POST', '/link-request', { email, provider }), 'Failed to send confirmation email');
  }

  async verifyLinkingToken(token: string, provider: string): Promise<AuthResult> {
    return this.doneAndRecheck(await this.api('POST', '/link-verify', { token, provider }), 'Failed to verify linking token');
  }

  async verifyConflictLinkingToken(token: string): Promise<AuthResult> {
    return this.doneAndRecheck(
      await this.api('POST', '/link-verify', { token, loginAfterLinking: true }),
      'Failed to verify linking token',
    );
  }

  async getLinkedAccounts(): Promise<LinkedAccountsResult> {
    const r = await this.api('GET', '/linked-accounts');
    if (!r.ok) return { ...this.fail(r, 'Failed to load linked accounts'), linkedAccounts: [] };
    return { success: true, linkedAccounts: Array.isArray(r.data?.linkedAccounts) ? r.data.linkedAccounts : [] };
  }

  async unlinkAccount(provider: string, providerAccountId: string): Promise<AuthResult> {
    return this.done(
      await this.api('DELETE', `/linked-accounts/${encodeURIComponent(provider)}/${encodeURIComponent(providerAccountId)}`),
      'Failed to unlink account',
    );
  }

  // ── Account ────────────────────────────────────────────────────────────

  /** Deletes the account and clears the local session on success. */
  async deleteAccount(): Promise<AuthResult> {
    const result = this.done(await this.api('DELETE', '/account'), 'Failed to delete account');
    if (result.success) {
      this.checkGeneration++;
      this.sessionGeneration++;
      await this.clearTokens();
      this.setState({ user: null, isLoading: false, error: null });
    }
    return result;
  }
}
