import type { MiddlewareHandler } from 'hono';
import type { AppEnv, Env, Identity } from './env';
import { verifyAccessJwt } from './access';

const JWT_HEADER = 'Cf-Access-Jwt-Assertion';
const JWT_COOKIE = 'CF_Authorization';

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

/**
 * Resolves the caller.
 *
 * Production: verify the Access JWT. A human logging in through an IdP carries
 * an `email` claim; a service token carries `common_name` (its client id) and no
 * email, which is how the MCP server identifies itself.
 *
 * Local: Access can only protect a real zone, so `wrangler dev` has nothing in
 * front of it. `DEV_IDENTITY` stands in for the signed-in user there. It is
 * empty in the deployed config, so if the Access config were ever removed the
 * app would 401 rather than silently fall back to an open dev identity.
 */
export async function resolveIdentity(env: Env, req: Request): Promise<Identity | null> {
  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.ACCESS_AUD?.trim();

  if (teamDomain && aud) {
    const token =
      req.headers.get(JWT_HEADER) ?? cookieValue(req.headers.get('cookie'), JWT_COOKIE);
    if (!token) return null;

    const result = await verifyAccessJwt(token, { teamDomain, aud });
    if (!result.ok) {
      console.warn('rejected Access assertion:', result.reason);
      return null;
    }

    const { email, common_name: commonName } = result.claims;
    if (email) return { actor: email, kind: 'user' };
    if (commonName) return { actor: `service:${commonName}`, kind: 'service' };
    return null;
  }

  const dev = env.DEV_IDENTITY?.trim();
  return dev ? { actor: dev, kind: 'user' } : null;
}

export const requireIdentity: MiddlewareHandler<AppEnv> = async (c, next) => {
  const identity = await resolveIdentity(c.env, c.req.raw);
  if (!identity) {
    return c.json({ error: 'unauthenticated' }, 401);
  }
  c.set('identity', identity);
  await next();
};
