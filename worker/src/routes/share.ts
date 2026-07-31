import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env';
import { webBase } from '../env';
import { shareToken } from '../ids';
import { getCollection, getScreenshot, now, type ShareLinkRow } from '../db';

export const share = new Hono<AppEnv>();

async function mint(
  c: Context<AppEnv>,
  kind: 'collection' | 'screenshot',
  targetId: string,
) {
  // Reuse an existing live link so repeatedly hitting Share doesn't litter the
  // revoke list with equivalent tokens.
  const existing = await c.env.DB.prepare(
    'SELECT * FROM share_links WHERE kind = ? AND target_id = ? AND revoked = 0 ORDER BY created_at DESC LIMIT 1',
  )
    .bind(kind, targetId)
    .first<ShareLinkRow>();

  const token = existing?.token ?? shareToken();
  if (!existing) {
    await c.env.DB.prepare(
      'INSERT INTO share_links (token, kind, target_id, created_by, revoked, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    )
      .bind(token, kind, targetId, c.get('identity').actor, now())
      .run();
  }

  return c.json(
    { token, kind, target_id: targetId, url: `${webBase(c.env, c.req.raw)}/p/${token}` },
    existing ? 200 : 201,
  );
}

share.post('/collections/:cid/share', async (c) => {
  const cid = c.req.param('cid');
  if (!(await getCollection(c.env.DB, cid))) return c.json({ error: 'collection not found' }, 404);
  return mint(c, 'collection', cid);
});

share.post('/screenshots/:sid/share', async (c) => {
  const sid = c.req.param('sid');
  if (!(await getScreenshot(c.env.DB, sid))) return c.json({ error: 'screenshot not found' }, 404);
  return mint(c, 'screenshot', sid);
});

share.get('/share-links', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT sl.*,
            CASE sl.kind
              WHEN 'collection' THEN (SELECT name FROM collections WHERE id = sl.target_id)
              ELSE (SELECT filename FROM screenshots WHERE id = sl.target_id)
            END AS target_label
       FROM share_links sl
      WHERE sl.revoked = 0
      ORDER BY sl.created_at DESC`,
  ).all<ShareLinkRow & { target_label: string | null }>();

  const base = webBase(c.env, c.req.raw);
  return c.json({
    links: (results ?? []).map((l) => ({
      token: l.token,
      kind: l.kind,
      target_id: l.target_id,
      target_label: l.target_label,
      created_by: l.created_by,
      created_at: l.created_at,
      url: `${base}/p/${l.token}`,
    })),
  });
});

share.delete('/share-links/:token', async (c) => {
  const token = c.req.param('token');
  // An already-revoked token is gone as far as every other route is concerned,
  // so revoking it again is a 404 rather than a silent success.
  const existing = await c.env.DB.prepare('SELECT * FROM share_links WHERE token = ? AND revoked = 0')
    .bind(token)
    .first<ShareLinkRow>();
  if (!existing) return c.json({ error: 'share link not found' }, 404);

  await c.env.DB.prepare('UPDATE share_links SET revoked = 1 WHERE token = ?').bind(token).run();
  return c.json({ ok: true });
});
