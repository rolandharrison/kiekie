import { Hono } from 'hono';
import type { AppEnv } from './env';
import { requireIdentity } from './auth';
import { appShell } from './assets';
import { collections } from './routes/collections';
import { screenshots, uploads } from './routes/screenshots';
import { annotations, screenshotAnnotations } from './routes/annotations';
import { share } from './routes/share';
import { img } from './routes/img';
import { publicRoutes } from './routes/public';

const app = new Hono<AppEnv>();

app.get('/health', (c) => c.json({ ok: true }));

// Public share routes come first and are deliberately outside the auth wall.
app.route('/p', publicRoutes);

// CSRF backstop for the cookie-authenticated browser session. Access's
// SameSite cookie already stops a cross-site form post from carrying auth,
// but that lives in Cloudflare's config, not this code — so also refuse any
// state-changing request whose Origin disagrees with the request URL.
// Non-browser callers (MCP, curl) send no Origin header and are unaffected.
app.use('/api/*', async (c, next) => {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(c.req.url).origin) {
      return c.json({ error: 'cross-origin request rejected' }, 403);
    }
  }
  await next();
});

// Everything below requires an identity (Access email or service token).
app.use('/api/*', requireIdentity);
app.use('/img/*', requireIdentity);

app.get('/api/me', (c) => c.json({ identity: c.get('identity') }));

app.route('/api/collections', collections);
app.route('/api/collections', uploads);
app.route('/api/screenshots', screenshots);
app.route('/api/screenshots', screenshotAnnotations);
app.route('/api/annotations', annotations);
app.route('/api', share);
app.route('/img', img);

app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

app.onError((err, c) => {
  console.error('unhandled error', err);
  return c.json({ error: 'internal error' }, 500);
});

/**
 * SPA fallback: anything that isn't an API/asset path is a client-side route
 * (`/`, `/c/:cid`, `/c/:cid/s/:sid`, `/shares`), so serve the app shell.
 */
app.all('*', async (c) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    return c.json({ error: 'not found' }, 404);
  }
  if (!c.env.ASSETS) return appShell(c);
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  if (asset.status !== 404) return asset;
  return appShell(c);
});

export default app;
