/**
 * A wire-level fake of an awesome-*-auth backend: a `fetch` that routes by
 * method and path and records every request, so tests assert on real
 * response shapes and real headers rather than on a mocked client.
 */
export interface RecordedCall {
  method: string;
  url: string;
  path: string;
  headers: Headers;
  credentials: RequestCredentials | undefined;
  body: unknown;
}

export interface Reply {
  status?: number;
  body?: unknown;
}

type Handler = (call: RecordedCall) => Reply | Promise<Reply>;

export function createFakeBackend(origin = 'http://localhost:3000') {
  const routes = new Map<string, Handler[]>();
  const calls: RecordedCall[] = [];

  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const resolved = new URL(url, origin);
    const method = (init.method ?? 'GET').toUpperCase();
    let body: unknown = undefined;
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: RecordedCall = {
      method,
      url: resolved.href,
      path: resolved.pathname,
      headers: new Headers(init.headers),
      credentials: init.credentials,
      body,
    };
    calls.push(call);

    const key = `${method} ${resolved.pathname}`;
    const queue = routes.get(key);
    if (!queue || queue.length === 0) {
      return new Response(JSON.stringify({ error: `no route for ${key}` }), { status: 404 });
    }
    // The last handler of a route is sticky; earlier ones answer once each.
    const handler = queue.length > 1 ? queue.shift()! : queue[0]!;
    const reply = await handler(call);
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return {
    fetch: fetchImpl as typeof fetch,
    calls,
    /** Queue answers for `METHOD /path`; the last one repeats. */
    on(route: string, ...handlers: Array<Handler | Reply>) {
      const list = routes.get(route) ?? [];
      for (const h of handlers) list.push(typeof h === 'function' ? h : () => h);
      routes.set(route, list);
      return this;
    },
    /** Replace every answer for `METHOD /path`. */
    set(route: string, ...handlers: Array<Handler | Reply>) {
      routes.delete(route);
      return this.on(route, ...handlers);
    },
    callsTo(route: string) {
      const [method, path] = route.split(' ');
      return calls.filter((c) => c.method === method && c.path === path);
    },
  };
}

export const ALICE = {
  sub: 'usr_alice',
  email: 'alice@example.com',
  role: 'user',
  loginProvider: 'local',
  isEmailVerified: true,
  isTotpEnabled: false,
};

export const UNAUTHORIZED: Reply = { status: 401, body: { error: 'Unauthorized' } };
