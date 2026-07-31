import type { Context } from 'hono';
import type { AppEnv } from './env';

/**
 * Serve the SPA shell for a client-side route. The ASSETS binding is absent in
 * the Worker unit-test environment (Miniflare doesn't wire static assets there),
 * so this degrades to a marker response instead of throwing — browser behaviour
 * is covered by the Playwright suite.
 */
export async function appShell(c: Context<AppEnv>, status = 200): Promise<Response> {
  if (!c.env.ASSETS) {
    return c.text('app shell', status as 200, { 'content-type': 'text/html' });
  }
  const res = await c.env.ASSETS.fetch(
    new Request(new URL('/index.html', c.req.url), { method: 'GET' }),
  );
  if (status === 200) return res;
  // A dead share link still renders the app so the visitor sees a real "this
  // link was revoked" page rather than a raw JSON body — but the status code
  // stays honest.
  return new Response(res.body, { status, headers: res.headers });
}
