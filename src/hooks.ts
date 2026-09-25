import { useContext } from 'react';
import { AwesomeAuthContext, type AwesomeAuthContextValue } from './AwesomeAuthProvider';
import type { AwesomeAuthClient } from './client';
import type { AuthUser } from './types';

/**
 * The auth state and actions: `{ user, isAuthenticated, isLoading, error,
 * login, logout, refresh, checkSession, client }`.
 *
 * @throws when called outside an `<AwesomeAuthProvider>`.
 */
export function useAwesomeAuth<TUser extends AuthUser = AuthUser>(): AwesomeAuthContextValue<TUser> {
  const ctx = useContext(AwesomeAuthContext);
  if (!ctx) {
    throw new Error(
      'useAwesomeAuth() must be used inside <AwesomeAuthProvider>. ' +
        'Wrap your app (or the subtree that needs auth) in <AwesomeAuthProvider options={{ apiPrefix: "/auth" }}>.',
    );
  }
  return ctx as unknown as AwesomeAuthContextValue<TUser>;
}

/**
 * The signed-in user, or `null`. The type parameter describes the extra
 * claims your backend adds to the token payload.
 */
export function useAuthUser<TUser extends AuthUser = AuthUser>(): TUser | null {
  return useAwesomeAuth<TUser>().user;
}

/** The underlying client, for the calls the hook does not surface. */
export function useAuthClient<TUser extends AuthUser = AuthUser>(): AwesomeAuthClient<TUser> {
  return useAwesomeAuth<TUser>().client;
}
