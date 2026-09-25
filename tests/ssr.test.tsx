// @vitest-environment node
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AwesomeAuthProvider } from '../src/AwesomeAuthProvider';
import { ProtectedRoute } from '../src/components';
import { useAwesomeAuth } from '../src/hooks';

function Status() {
  const { isLoading, isAuthenticated } = useAwesomeAuth();
  return <p>{isLoading ? 'loading' : isAuthenticated ? 'in' : 'out'}</p>;
}

describe('server render', () => {
  it('renders isLoading: true, no window, no request', () => {
    expect(typeof window).toBe('undefined');
    const fetchSpy = vi.fn();

    const html = renderToString(
      <AwesomeAuthProvider options={{ fetch: fetchSpy as unknown as typeof fetch }}>
        <Status />
        <ProtectedRoute fallback={<span>gate-fallback</span>} redirectTo="/login">
          <span>secret</span>
        </ProtectedRoute>
      </AwesomeAuthProvider>,
    );

    expect(html).toContain('loading');
    expect(html).toContain('gate-fallback');
    expect(html).not.toContain('secret');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

});

describe('server entry', () => {
  it('exposes hasRole and SERVER_SNAPSHOT without the client boundary', async () => {
    const server = await import('../src/server');
    expect(server.hasRole({ sub: 'u', email: 'e', roles: ['admin'] }, 'admin')).toBe(true);
    expect(server.hasRole(null, 'admin')).toBe(false);
    expect(server.SERVER_SNAPSHOT).toEqual({ user: null, isAuthenticated: false, isLoading: true, error: null });
  });
});
