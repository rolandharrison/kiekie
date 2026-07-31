import type { MiddlewareHandler } from 'hono';
import type { AppEnv, Env, Identity } from './env';

const EMAIL_HEADER = 'Cf-Access-Authenticated-User-Email';
const CLIENT_ID_HEADER = 'CF-Access-Client-Id';
const CLIENT_SECRET_HEADER = 'CF-Access-Client-Secret';

/**
 * Cloudflare Access validates the caller *before* the request reaches the Worker,
 * so these headers are authoritative — but only when the Worker is actually behind
 * Access. `TRUST_ACCESS_HEADERS` gates that so a local/dev deployment can't be
 * spoofed by a client simply setting the header itself.
 */
export function resolveIdentity(env: Env, req: Request): Identity | null {
  const trusted = env.TRUST_ACCESS_HEADERS === '1' || env.TRUST_ACCESS_HEADERS === 'true';

  if (trusted) {
    const email = req.headers.get(EMAIL_HEADER);
    if (email) return { actor: email, kind: 'user' };

    const clientId = req.headers.get(CLIENT_ID_HEADER);
    const clientSecret = req.headers.get(CLIENT_SECRET_HEADER);
    if (clientId && clientSecret) return { actor: `service:${clientId}`, kind: 'service' };

    return null;
  }

  const dev = env.DEV_IDENTITY?.trim();
  return dev ? { actor: dev, kind: 'user' } : null;
}

export const requireIdentity: MiddlewareHandler<AppEnv> = async (c, next) => {
  const identity = resolveIdentity(c.env, c.req.raw);
  if (!identity) {
    return c.json({ error: 'unauthenticated' }, 401);
  }
  c.set('identity', identity);
  await next();
};
