import { isBrowser, isReactNative } from './ssr';
import type { AuthTransportMode } from './types';

/** Cookie names the backends use for the double-submit CSRF token, by priority. */
const CSRF_COOKIES = ['__Host-csrf-token', '__Secure-csrf-token', 'csrf-token'] as const;

export const CSRF_HEADER = 'X-CSRF-Token';
export const STRATEGY_HEADER = 'X-Auth-Strategy';

/** Bearer on React Native, cookie everywhere else. */
export function detectDefaultMode(): AuthTransportMode {
  return isReactNative() ? 'bearer' : 'cookie';
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined' || typeof document.cookie !== 'string') return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + escaped + '=([^;]*)'));
  if (!match || match[1] === undefined) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** The CSRF token the backend put in a readable cookie, if any. */
export function readCsrfToken(): string | null {
  for (const name of CSRF_COOKIES) {
    const value = readCookie(name);
    if (value) return value;
  }
  return null;
}

/** Strips trailing slashes: `/auth/` and `/auth` mount the same router. */
export function normalizePrefix(prefix: string): string {
  return prefix.replace(/\/+$/, '');
}

/**
 * Origin of `url`, resolved against the page when it is relative. `null` when
 * it cannot be resolved (a relative URL with no page, as on React Native or on
 * a server render).
 */
export function originOf(url: string): string | null {
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return new URL(url).origin;
    if (!isBrowser()) return null;
    return new URL(url, window.location.href).origin;
  } catch {
    return null;
  }
}

/**
 * `true` when `url` points at the auth backend: same origin as `apiPrefix`.
 * Credentials, CSRF and bearer tokens are only ever attached to these
 * requests, so a third-party call made through `client.fetch` never sees them.
 */
export function isBackendUrl(url: string, apiPrefix: string): boolean {
  const backend = originOf(apiPrefix || '/');
  const target = originOf(url);
  if (backend !== null && target !== null) return backend === target;
  // Neither side resolvable (relative URLs with no page): both are relative to
  // the same unknown origin only when both are relative paths.
  return backend === null && target === null && url.startsWith('/') && !url.startsWith('//');
}

/** Absolute or page-relative URL of `path` under `apiPrefix`, without the query. */
export function pathOf(url: string): string {
  try {
    const base = isBrowser() ? window.location.href : 'http://localhost';
    return new URL(url, base).pathname.replace(/\/+$/, '');
  } catch {
    return url.split(/[?#]/)[0] ?? url;
  }
}

/**
 * Auth endpoints whose 401/403 is an answer, not an expired session: never
 * refresh-and-retry them. `/me` is deliberately absent: a 401 there after a
 * page reload means "access token expired", and a refresh recovers it.
 * The list is ng-awesome-node-auth's, plus the two pre-session verify routes
 * that answer a bare 401 for a wrong code (a retry would resubmit the code).
 */
const NO_RETRY_SUFFIXES = [
  '/login',
  '/logout',
  '/refresh',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/2fa/verify',
  '/verify-email',
  '/sms/verify',
  '/magic-link/verify',
] as const;

export function isNoRetryEndpoint(url: string, apiPrefix: string): boolean {
  const prefixPath = pathOf(apiPrefix || '/');
  const path = pathOf(url);
  return NO_RETRY_SUFFIXES.some((suffix) => path === prefixPath + suffix);
}
