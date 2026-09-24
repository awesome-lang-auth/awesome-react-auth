import { useEffect, type ReactNode } from 'react';
import { useAwesomeAuth } from './hooks';
import { isBrowser } from './ssr';
import type { AuthUser } from './types';

/** `true` when `user` holds `role`, as its primary role or among its RBAC roles. */
export function hasRole(user: AuthUser | null, role: string | readonly string[]): boolean {
  if (!user) return false;
  const wanted = typeof role === 'string' ? [role] : role;
  return wanted.some((r) => user.role === r || (Array.isArray(user.roles) && user.roles.includes(r)));
}

function navigate(to: string): void {
  if (isBrowser()) window.location.assign(to);
}

export interface ProtectedRouteProps {
  children?: ReactNode;
  /** Rendered while the session is unknown and while leaving. Default `null`. */
  fallback?: ReactNode;
  /** Full-page navigation target for signed-out visitors (e.g. `/auth/ui/login`). */
  redirectTo?: string;
  /**
   * Called once when the visitor turns out to be signed out; wins over
   * `redirectTo`. Use it to drive your router (`navigate('/login')`).
   */
  onUnauthenticated?: () => void;
  /** Also require one of these roles (`user.role` or `user.roles`). */
  role?: string | readonly string[];
  /** Rendered for a signed-in user without the role. Default `fallback`. */
  forbidden?: ReactNode;
}

/**
 * Renders `children` for a signed-in user (with `role`, when given).
 *
 * Router-agnostic: it only renders. For a signed-out visitor it calls
 * `onUnauthenticated`, or navigates to `redirectTo`, from an effect (never
 * during render), and shows `fallback` meanwhile. With React Router you can
 * also just render `<Navigate>` as the fallback of an `isAuthenticated` check.
 */
export function ProtectedRoute({
  children,
  fallback = null,
  redirectTo,
  onUnauthenticated,
  role,
  forbidden,
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user } = useAwesomeAuth();
  const signedOut = !isLoading && !isAuthenticated;

  useEffect(() => {
    if (!signedOut) return;
    if (onUnauthenticated) onUnauthenticated();
    else if (redirectTo) navigate(redirectTo);
    // Callers pass inline callbacks: react to the state flip, not to identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedOut, redirectTo]);

  if (isLoading || !isAuthenticated) return <>{fallback}</>;
  if (role !== undefined && !hasRole(user, role)) return <>{forbidden ?? fallback}</>;
  return <>{children}</>;
}

export interface AnonymousOnlyProps {
  children?: ReactNode;
  /** Rendered while the session is unknown and for signed-in users. Default `null`. */
  fallback?: ReactNode;
  /** Full-page navigation target for signed-in users (e.g. `/`). */
  redirectTo?: string;
  /** Called once when the user turns out to be signed in; wins over `redirectTo`. */
  onAuthenticated?: () => void;
}

/** Renders `children` only for signed-out visitors: login and register forms. */
export function AnonymousOnly({ children, fallback = null, redirectTo, onAuthenticated }: AnonymousOnlyProps) {
  const { isAuthenticated, isLoading } = useAwesomeAuth();
  const signedIn = !isLoading && isAuthenticated;

  useEffect(() => {
    if (!signedIn) return;
    if (onAuthenticated) onAuthenticated();
    else if (redirectTo) navigate(redirectTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, redirectTo]);

  if (isLoading || isAuthenticated) return <>{fallback}</>;
  return <>{children}</>;
}
