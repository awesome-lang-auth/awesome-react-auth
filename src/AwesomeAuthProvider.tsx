import { createContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { AwesomeAuthClient } from './client';
import { getServerSnapshot } from './ssr';
import type { AuthClientOptions, AuthResult, AuthState, AuthUser, LoginResult } from './types';

/** What {@link useAwesomeAuth} returns. */
export interface AwesomeAuthContextValue<TUser extends AuthUser = AuthUser> extends AuthState<TUser> {
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<AuthResult>;
  refresh: () => Promise<AuthResult>;
  checkSession: () => Promise<TUser | null>;
  client: AwesomeAuthClient<TUser>;
}

export const AwesomeAuthContext = createContext<AwesomeAuthContextValue | null>(null);
AwesomeAuthContext.displayName = 'AwesomeAuthContext';

interface ProviderBaseProps {
  children?: ReactNode;
  /**
   * Run `checkSession()` on mount. Default `true`. With `false`, the state
   * stays `isLoading` (and the gates on their fallback) until you call
   * `client.checkSession()` yourself.
   */
  initializeOnStartup?: boolean;
}

export type AwesomeAuthProviderProps =
  | (ProviderBaseProps & {
      /** A client you created: shared with non-React code, never disposed here. */
      client: AwesomeAuthClient<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      options?: never;
    })
  | (ProviderBaseProps & {
      client?: never;
      /**
       * Options for the client the provider creates on first render. Read
       * once: changing them later does not rebuild the client.
       */
      options?: AuthClientOptions;
    });

/**
 * Makes the auth state available to {@link useAwesomeAuth} and the gates.
 *
 * Pass either an existing `client` or `options` (`apiPrefix`, `mode`, ...);
 * with neither, the client targets `/auth` on the page origin. State is read
 * through `useSyncExternalStore`, so components re-render only when the
 * snapshot changes, and server renders see `isLoading: true`.
 */
export function AwesomeAuthProvider(props: AwesomeAuthProviderProps) {
  const { children, initializeOnStartup = true } = props;
  // Created on first need and kept, even if the parent later switches between
  // `client` and `options`.
  const ownClient = useRef<AwesomeAuthClient | null>(null);
  let client: AwesomeAuthClient;
  if (props.client) {
    client = props.client;
  } else {
    ownClient.current ??= new AwesomeAuthClient(props.options);
    client = ownClient.current;
  }

  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, getServerSnapshot);

  useEffect(() => {
    // The client shares an in-flight check, so a StrictMode double mount
    // still sends one request; an injected client already checked is left alone.
    if (initializeOnStartup && !client.isInitialized()) void client.checkSession();
  }, [client, initializeOnStartup]);

  // Stable across state changes: `useEffect(..., [logout])` does not re-run on login.
  const actions = useMemo(
    () => ({
      login: (email: string, password: string) => client.login(email, password),
      logout: () => client.logout(),
      refresh: () => client.refresh(),
      checkSession: () => client.checkSession(),
    }),
    [client],
  );

  const value = useMemo<AwesomeAuthContextValue>(() => ({ ...state, ...actions, client }), [state, actions, client]);

  return <AwesomeAuthContext.Provider value={value}>{children}</AwesomeAuthContext.Provider>;
}
