import { Hono } from 'hono';
import type { AppEnv, Env } from '../env';

/**
 * Streams a blob out of the private R2 bucket. Objects are immutable (the key
 * contains a random screenshot id), so they can be cached hard — but privately,
 * since the response is only reachable behind Access.
 */
export async function streamObject(env: Env, key: string, request: Request): Promise<Response> {
  const object = await env.BUCKET.get(key);
  if (!object) return new Response(JSON.stringify({ error: 'not found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'private, max-age=31536000, immutable');
  if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');

  if (request.headers.get('if-none-match') === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(object.body, { headers });
}

export const img = new Hono<AppEnv>();

// Keys contain a slash (`{cid}/{sid}.png`), hence the wildcard param.
img.get('/:key{.+}', async (c) => streamObject(c.env, c.req.param('key'), c.req.raw));
