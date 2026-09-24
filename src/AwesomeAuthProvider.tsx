import { createContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
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
  /** Run `checkSession()` on mount. Default `true`. */
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
  const [ownClient] = useState(() => (props.client ? null : new AwesomeAuthClient(props.options)));
  const client = (props.client ?? ownClient) as AwesomeAuthClient;

  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, getServerSnapshot);

  useEffect(() => {
    // The client shares an in-flight check, so a StrictMode double mount
    // still sends one request; an injected client already checked is left alone.
    if (initializeOnStartup && !client.isInitialized()) void client.checkSession();
  }, [client, initializeOnStartup]);

  const value = useMemo<AwesomeAuthContextValue>(
    () => ({
      ...state,
      login: (email, password) => client.login(email, password),
      logout: () => client.logout(),
      refresh: () => client.refresh(),
      checkSession: () => client.checkSession(),
      client,
    }),
    [state, client],
  );

  return <AwesomeAuthContext.Provider value={value}>{children}</AwesomeAuthContext.Provider>;
}
