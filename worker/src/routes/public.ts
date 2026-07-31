import { Hono } from 'hono';
import type { AppEnv } from '../env';
import {
  getCollection,
  getScreenshot,
  listAnnotations,
  shapeAnnotation,
  type ScreenshotRow,
  type ShareLinkRow,
} from '../db';
import { streamObject } from './img';
import { appShell } from '../assets';

/**
 * Public, read-only share routes. Mounted *before* the auth middleware and
 * containing no write verbs at all — "public visitors never write" is enforced by
 * this router's shape, not by hiding buttons in the UI.
 */
export const publicRoutes = new Hono<AppEnv>();

async function resolveToken(c: { env: AppEnv['Bindings'] }, token: string) {
  return c.env.DB.prepare('SELECT * FROM share_links WHERE token = ? AND revoked = 0')
    .bind(token)
    .first<ShareLinkRow>();
}

publicRoutes.get('/:token/data', async (c) => {
  const link = await resolveToken(c, c.req.param('token'));
  if (!link) return c.json({ error: 'link not found or revoked' }, 404);

  if (link.kind === 'collection') {
    const collection = await getCollection(c.env.DB, link.target_id);
    if (!collection) return c.json({ error: 'link target no longer exists' }, 404);

    const { results } = await c.env.DB.prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM annotations a WHERE a.screenshot_id = s.id) AS annotation_count
         FROM screenshots s WHERE s.collection_id = ?
        ORDER BY s.created_at DESC, s.id DESC`,
    )
      .bind(link.target_id)
      .all<ScreenshotRow & { annotation_count: number }>();

    const shots = results ?? [];
    const annotations: ReturnType<typeof shapeAnnotation>[] = [];
    for (const s of shots) {
      annotations.push(...(await listAnnotations(c.env.DB, s.id)).map(shapeAnnotation));
    }

    return c.json({ kind: 'collection', collection, screenshots: shots, annotations });
  }

  const shot = await getScreenshot(c.env.DB, link.target_id);
  if (!shot) return c.json({ error: 'link target no longer exists' }, 404);
  const collection = await getCollection(c.env.DB, shot.collection_id);
  const annotations = (await listAnnotations(c.env.DB, shot.id)).map(shapeAnnotation);

  return c.json({ kind: 'screenshot', collection, screenshots: [shot], annotations });
});

publicRoutes.get('/:token/img/:key{.+}', async (c) => {
  const link = await resolveToken(c, c.req.param('token'));
  if (!link) return c.json({ error: 'link not found or revoked' }, 404);

  const key = c.req.param('key');
  // Scope check: the requested key must belong to this link's target. Without
  // this, any valid token would be a read key for the entire bucket.
  const row =
    link.kind === 'collection'
      ? await c.env.DB.prepare('SELECT id FROM screenshots WHERE r2_key = ? AND collection_id = ?')
          .bind(key, link.target_id)
          .first<{ id: string }>()
      : await c.env.DB.prepare('SELECT id FROM screenshots WHERE r2_key = ? AND id = ?')
          .bind(key, link.target_id)
          .first<{ id: string }>();

  if (!row) return c.json({ error: 'not found' }, 404);
  return streamObject(c.env, key, c.req.raw);
});

/** The viewer page itself — the SPA shell; the SPA fetches `/p/:token/data`. */
publicRoutes.get('/:token', async (c) => {
  const link = await resolveToken(c, c.req.param('token'));
  return appShell(c, link ? 200 : 404);
});

publicRoutes.get('/:token/s/:sid', async (c) => {
  const link = await resolveToken(c, c.req.param('token'));
  return appShell(c, link ? 200 : 404);
});
