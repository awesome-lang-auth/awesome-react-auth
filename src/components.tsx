import { useEffect, useRef, type ReactNode } from 'react';
import { useAwesomeAuth } from './hooks';
import { hasRole } from './roles';
import { isBrowser } from './ssr';

/**
 * Runs `action` once each time `condition` becomes true: not again on a
 * StrictMode effect replay, nor when the caller passes a new inline callback.
 * The latest callback is the one called.
 */
function useOnceWhen(condition: boolean, action: () => void): void {
  const latest = useRef(action);
  latest.current = action;
  const fired = useRef(false);
  useEffect(() => {
    if (!condition) {
      fired.current = false;
      return;
    }
    if (fired.current) return;
    fired.current = true;
    latest.current();
  }, [condition]);
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

  useOnceWhen(signedOut, () => {
    if (onUnauthenticated) onUnauthenticated();
    else if (redirectTo) navigate(redirectTo);
  });

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

  useOnceWhen(signedIn, () => {
    if (onAuthenticated) onAuthenticated();
    else if (redirectTo) navigate(redirectTo);
  });

  if (isLoading || isAuthenticated) return <>{fallback}</>;
  return <>{children}</>;
}
