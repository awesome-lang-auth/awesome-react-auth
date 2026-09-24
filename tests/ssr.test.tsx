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

  it('imports the package entry without touching browser globals', async () => {
    const mod = await import('../src/index');
    expect(mod.SERVER_SNAPSHOT.isLoading).toBe(true);
    expect(new mod.AwesomeAuthClient().mode).toBe('cookie');
  });
});
