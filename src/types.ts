/**
 * Public types of `@awesome-lang-auth/react`.
 *
 * The shapes follow the awesome-node-auth wire protocol, which every backend
 * of the family (node, go, lambda, ...) serves unchanged. Field names are the
 * wire names: the user id is `sub`, not `id`.
 */

/**
 * The user returned by `GET <apiPrefix>/me`: the access-token payload.
 *
 * `sub`, `email`, `role`, `loginProvider`, `isEmailVerified` and
 * `isTotpEnabled` are always present. `metadata` appears when the backend has a
 * metadata store, `roles` / `permissions` when it has an RBAC store. Extra
 * claims added by the backend's `buildTokenPayload` land on the same object;
 * type them with the generic parameter of {@link useAuthUser}.
 */
export interface AuthUser {
  sub: string;
  email: string;
  role?: string;
  loginProvider?: string;
  isEmailVerified?: boolean;
  isTotpEnabled?: boolean;
  metadata?: Record<string, unknown>;
  roles?: string[];
  permissions?: string[];
  [claim: string]: unknown;
}

/** Snapshot of the authentication state, as read by React. */
export interface AuthState<TUser extends AuthUser = AuthUser> {
  user: TUser | null;
  isAuthenticated: boolean;
  /**
   * `true` until the first session check has settled, and always on the
   * server. It does not flip during `login()` and friends: await their promise.
   */
  isLoading: boolean;
  /** Last session-check failure that was not a plain "not logged in". */
  error: string | null;
}

/** Result of every client call. Calls never throw on HTTP errors. */
export interface AuthResult {
  success: boolean;
  error?: string;
  /** Machine-readable error code from the backend, when it sends one. */
  code?: string;
}

/** Second factors the backend can offer after a password login. */
export type SecondFactorMethod = 'totp' | 'sms' | 'magic-link' | (string & {});

export interface LoginResult extends AuthResult {
  /** The password was right; a second factor is needed. `success` is `true`. */
  requires2fa?: boolean;
  /** The account must enrol a second factor first (the backend answers 403). */
  requires2FASetup?: boolean;
  /** Short-lived token for the 2FA step-up calls. */
  tempToken?: string;
  availableMethods?: SecondFactorMethod[];
}

export interface RegisterResult extends AuthResult {
  userId?: string;
}

export interface TwoFactorSetupResult extends AuthResult {
  secret?: string;
  qrCode?: string;
}

export interface SessionInfo {
  sessionHandle: string;
  userId: string;
  userAgent?: string;
  ipAddress?: string;
  createdAt: string;
  lastActive: string;
  [key: string]: unknown;
}

export interface SessionsResult extends AuthResult {
  sessions: SessionInfo[];
}

export interface LinkedAccount {
  provider: string;
  providerAccountId: string;
  [key: string]: unknown;
}

export interface LinkedAccountsResult extends AuthResult {
  linkedAccounts: LinkedAccount[];
}

/**
 * How tokens travel.
 *
 * - `cookie`: HttpOnly cookies set by the backend, `credentials: 'include'`,
 *   `X-CSRF-Token` from the CSRF cookie. The web default.
 * - `bearer`: the client sends `X-Auth-Strategy: bearer`, receives the tokens
 *   in the JSON body, keeps them in a {@link TokenStorage} and sends
 *   `Authorization: Bearer`. The React Native default.
 */
export type AuthTransportMode = 'cookie' | 'bearer';

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
}

/**
 * Where bearer tokens live. Methods may be sync or async, so AsyncStorage,
 * expo-secure-store or react-native-keychain fit behind a three-line adapter.
 * The package ships only {@link MemoryTokenStorage} and depends on none of them.
 */
export interface TokenStorage {
  load(): StoredTokens | null | Promise<StoredTokens | null>;
  save(tokens: StoredTokens): void | Promise<void>;
  clear(): void | Promise<void>;
}

export interface AuthClientOptions {
  /**
   * Where the auth router is mounted: a path on the page origin (`/auth`, the
   * default) or an absolute URL for a backend on another origin
   * (`https://api.example.com/auth`). React Native needs an absolute URL.
   */
  apiPrefix?: string;
  /**
   * Transport. Defaults to `bearer` on React Native and `cookie` everywhere
   * else; set it to override.
   */
  mode?: AuthTransportMode;
  /** Bearer-mode token store. Defaults to an in-memory store. */
  storage?: TokenStorage;
  /** `fetch` implementation. Defaults to the global one, resolved per call. */
  fetch?: typeof fetch;
}

/** Events the client emits besides state changes. */
export interface AuthEventMap<TUser extends AuthUser = AuthUser> {
  /** The user changed (login, logout, session check, expiry). */
  change: TUser | null;
  /** A token refresh succeeded. */
  refreshed: void;
  /** A refresh failed or the session was revoked while a user was signed in. */
  sessionExpired: { reason: 'refresh-failed' | 'revoked' };
  /** `logout()` completed (whatever the backend answered). */
  logout: void;
}

export type AuthEventName = keyof AuthEventMap;
