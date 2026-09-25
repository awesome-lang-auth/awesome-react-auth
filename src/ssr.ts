import type { AuthState } from './types';

/** `true` in a browser (or jsdom), `false` on a server render. */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/** `true` on React Native, where `navigator.product` is `'ReactNative'`. */
export function isReactNative(): boolean {
  return typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
}

/**
 * The state every server render sees, and the one React hydrates against:
 * nothing is known about the session until the browser asks `/me`.
 */
export const SERVER_SNAPSHOT: AuthState = Object.freeze({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
}) as AuthState;

export function getServerSnapshot(): AuthState {
  return SERVER_SNAPSHOT;
}
