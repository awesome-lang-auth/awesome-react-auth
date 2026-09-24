import { StrictMode, useRef } from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AwesomeAuthClient } from '../src/client';
import { AwesomeAuthProvider } from '../src/AwesomeAuthProvider';
import { AnonymousOnly, ProtectedRoute } from '../src/components';
import { useAuthUser, useAwesomeAuth } from '../src/hooks';
import { ALICE, UNAUTHORIZED, createFakeBackend } from './fakeBackend';

function Status() {
  const { user, isAuthenticated, isLoading } = useAwesomeAuth();
  if (isLoading) return <p>loading</p>;
  return <p>{isAuthenticated ? `hello ${user?.email}` : 'anonymous'}</p>;
}

function signedOutBackend() {
  return createFakeBackend().on('GET /auth/me', UNAUTHORIZED).on('POST /auth/refresh', UNAUTHORIZED);
}

describe('AwesomeAuthProvider', () => {
  it('initialises from an injected client', async () => {
    const be = createFakeBackend().on('GET /auth/me', { body: ALICE });
    const client = new AwesomeAuthClient({ fetch: be.fetch });

    render(
      <AwesomeAuthProvider client={client}>
        <Status />
      </AwesomeAuthProvider>,
    );

    expect(screen.getByText('loading')).toBeTruthy();
    expect(await screen.findByText('hello alice@example.com')).toBeTruthy();
  });

  it('builds its own client from options', async () => {
    const be = createFakeBackend().on('GET /api/auth/me', { body: ALICE });

    render(
      <AwesomeAuthProvider options={{ apiPrefix: '/api/auth', fetch: be.fetch }}>
        <Status />
      </AwesomeAuthProvider>,
    );

    expect(await screen.findByText('hello alice@example.com')).toBeTruthy();
  });

  it('goes logged out → login → logged in → logout', async () => {
    const be = signedOutBackend().on('POST /auth/login', { body: { success: true } });
    const client = new AwesomeAuthClient({ fetch: be.fetch });
    render(
      <AwesomeAuthProvider client={client}>
        <Status />
      </AwesomeAuthProvider>,
    );
    expect(await screen.findByText('anonymous')).toBeTruthy();

    be.set('GET /auth/me', { body: ALICE });
    await act(() => client.login('alice@example.com', 'pw'));
    expect(screen.getByText('hello alice@example.com')).toBeTruthy();

    be.on('POST /auth/logout', { body: { success: true } });
    await act(() => client.logout());
    expect(screen.getByText('anonymous')).toBeTruthy();
  });

  it('sends one /me under StrictMode', async () => {
    const be = createFakeBackend().on('GET /auth/me', { body: ALICE });
    const client = new AwesomeAuthClient({ fetch: be.fetch });

    render(
      <StrictMode>
        <AwesomeAuthProvider client={client}>
          <Status />
        </AwesomeAuthProvider>
      </StrictMode>,
    );

    await screen.findByText('hello alice@example.com');
    expect(be.callsTo('GET /auth/me')).toHaveLength(1);
  });

  it('does not re-check an injected client that already settled', async () => {
    const be = createFakeBackend().on('GET /auth/me', { body: ALICE });
    const client = new AwesomeAuthClient({ fetch: be.fetch });
    await client.checkSession();

    render(
      <AwesomeAuthProvider client={client}>
        <Status />
      </AwesomeAuthProvider>,
    );

    expect(screen.getByText('hello alice@example.com')).toBeTruthy();
    expect(be.callsTo('GET /auth/me')).toHaveLength(1);
  });

  it('respects initializeOnStartup={false}', () => {
    const be = createFakeBackend();
    render(
      <AwesomeAuthProvider options={{ fetch: be.fetch }} initializeOnStartup={false}>
        <Status />
      </AwesomeAuthProvider>,
    );

    expect(screen.getByText('loading')).toBeTruthy();
    expect(be.calls).toHaveLength(0);
  });

  it('unsubscribes on unmount', async () => {
    const be = createFakeBackend().on('GET /auth/me', { body: ALICE });
    const client = new AwesomeAuthClient({ fetch: be.fetch });
    const listeners = (client as unknown as { listeners: Set<unknown> }).listeners;
    const { unmount } = render(
      <AwesomeAuthProvider client={client}>
        <Status />
      </AwesomeAuthProvider>,
    );
    await screen.findByText('hello alice@example.com');
    expect(listeners.size).toBeGreaterThan(0);

    unmount();

    expect(listeners.size).toBe(0);
  });

  it('does not re-render consumers when the state is unchanged', async () => {
    const be = createFakeBackend().on('GET /auth/me', { body: ALICE });
    const client = new AwesomeAuthClient({ fetch: be.fetch });
    let renders = 0;
    function Counter() {
      useAwesomeAuth();
      renders++;
      return null;
    }
    render(
      <AwesomeAuthProvider client={client}>
        <Counter />
      </AwesomeAuthProvider>,
    );
    await waitFor(() => expect(client.getUser()).not.toBeNull());
    const settled = renders;

    await act(() => client.checkSession());

    expect(renders).toBe(settled);
  });
});

describe('hooks', () => {
  it('useAwesomeAuth throws a descriptive error outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAwesomeAuth())).toThrow(/inside <AwesomeAuthProvider>/);
  });

  it('useAuthUser returns the typed user', async () => {
    interface MyUser {
      sub: string;
      email: string;
      tenantId: string;
      [claim: string]: unknown;
    }
    const be = createFakeBackend().on('GET /auth/me', { body: { ...ALICE, tenantId: 't_1' } });
    const client = new AwesomeAuthClient({ fetch: be.fetch });
    function Tenant() {
      const user = useAuthUser<MyUser>();
      return <p>{user ? user.tenantId : 'none'}</p>;
    }

    render(
      <AwesomeAuthProvider client={client}>
        <Tenant />
      </AwesomeAuthProvider>,
    );

    expect(await screen.findByText('t_1')).toBeTruthy();
  });

  it('keeps action identities stable across renders with the same state', async () => {
    const be = createFakeBackend().on('GET /auth/me', { body: ALICE });
    const client = new AwesomeAuthClient({ fetch: be.fetch });
    await client.checkSession();
    const seen: unknown[] = [];
    function Probe({ tick }: { tick: number }) {
      const ctx = useAwesomeAuth();
      const ref = useRef(ctx);
      seen.push(ref.current === ctx);
      return <p>{tick}</p>;
    }
    const { rerender } = render(
      <AwesomeAuthProvider client={client}>
        <Probe tick={1} />
      </AwesomeAuthProvider>,
    );
    rerender(
      <AwesomeAuthProvider client={client}>
        <Probe tick={2} />
      </AwesomeAuthProvider>,
    );

    expect(seen).toEqual([true, true]);
  });
});

describe('ProtectedRoute', () => {
  function renderGate(client: AwesomeAuthClient, gate: React.ReactNode) {
    return render(<AwesomeAuthProvider client={client}>{gate}</AwesomeAuthProvider>);
  }

  it('shows the fallback while loading, then the children when signed in', async () => {
    const be = createFakeBackend().on('GET /auth/me', { body: ALICE });
    const client = new AwesomeAuthClient({ fetch: be.fetch });
    renderGate(
      client,
      <ProtectedRoute fallback={<p>wait</p>}>
        <p>secret</p>
      </ProtectedRoute>,
    );

    expect(screen.getByText('wait')).toBeTruthy();
    expect(await screen.findByText('secret')).toBeTruthy();
  });

  it('hides the children and calls onUnauthenticated once when signed out', async () => {
    const client = new AwesomeAuthClient({ fetch: signedOutBackend().fetch });
    const onUnauthenticated = vi.fn();
    renderGate(
      client,
      <ProtectedRoute fallback={<p>wait</p>} onUnauthenticated={onUnauthenticated}>
        <p>secret</p>
      </ProtectedRoute>,
    );

    await waitFor(() => expect(onUnauthenticated).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.getByText('wait')).toBeTruthy();
  });

  it('navigates to redirectTo when signed out', async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign, href: original.href } });
    try {
      const client = new AwesomeAuthClient({ fetch: signedOutBackend().fetch });
      renderGate(
        client,
        <ProtectedRoute redirectTo="/auth/ui/login">
          <p>secret</p>
        </ProtectedRoute>,
      );

      await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/ui/login'));
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('enforces role against role and roles', async () => {
    const be = createFakeBackend().on('GET /auth/me', { body: { ...ALICE, roles: ['editor'] } });
    const client = new AwesomeAuthClient({ fetch: be.fetch });
    renderGate(
      client,
      <>
        <ProtectedRoute role="admin" forbidden={<p>no admin</p>}>
          <p>admin area</p>
        </ProtectedRoute>
        <ProtectedRoute role={['admin', 'editor']}>
          <p>editor area</p>
        </ProtectedRoute>
      </>,
    );

    expect(await screen.findByText('editor area')).toBeTruthy();
    expect(screen.getByText('no admin')).toBeTruthy();
    expect(screen.queryByText('admin area')).toBeNull();
  });
});

describe('AnonymousOnly', () => {
  it('renders for signed-out visitors only', async () => {
    const client = new AwesomeAuthClient({ fetch: signedOutBackend().fetch });
    render(
      <AwesomeAuthProvider client={client}>
        <AnonymousOnly fallback={<p>wait</p>}>
          <p>login form</p>
        </AnonymousOnly>
      </AwesomeAuthProvider>,
    );

    expect(screen.getByText('wait')).toBeTruthy();
    expect(await screen.findByText('login form')).toBeTruthy();
  });

  it('hides for signed-in users and calls onAuthenticated', async () => {
    const be = createFakeBackend().on('GET /auth/me', { body: ALICE });
    const client = new AwesomeAuthClient({ fetch: be.fetch });
    const onAuthenticated = vi.fn();
    render(
      <AwesomeAuthProvider client={client}>
        <AnonymousOnly onAuthenticated={onAuthenticated}>
          <p>login form</p>
        </AnonymousOnly>
      </AwesomeAuthProvider>,
    );

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('login form')).toBeNull();
  });
});
