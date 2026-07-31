import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env';
import { webBase } from '../env';
import { shareToken } from '../ids';
import { getCollection, getScreenshot, hasExpired, inDays, now, type ShareLinkRow } from '../db';
import { readJson } from '../json';

export const share = new Hono<AppEnv>();

const MAX_EXPIRY_DAYS = 3650;

/**
 * `expires_in_days` is tri-state: absent leaves an existing link's expiry alone,
 * `null` makes it never expire, and a positive number sets a new deadline.
 */
type ExpiryRequest = { kind: 'unset' } | { kind: 'never' } | { kind: 'at'; value: string };

function parseExpiry(
  body: Record<string, unknown>,
): { ok: true; expiry: ExpiryRequest } | { ok: false; error: string } {
  const raw = body.expires_in_days;
  if (raw === undefined) return { ok: true, expiry: { kind: 'unset' } };
  if (raw === null) return { ok: true, expiry: { kind: 'never' } };
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { ok: false, error: 'expires_in_days must be a number or null' };
  }
  if (raw <= 0) return { ok: false, error: 'expires_in_days must be greater than 0' };
  if (raw > MAX_EXPIRY_DAYS) {
    return { ok: false, error: `expires_in_days must be at most ${MAX_EXPIRY_DAYS}` };
  }
  return { ok: true, expiry: { kind: 'at', value: inDays(raw) } };
}

function expiresAtOf(expiry: ExpiryRequest, fallback: string | null): string | null {
  if (expiry.kind === 'unset') return fallback;
  return expiry.kind === 'never' ? null : expiry.value;
}

async function mint(c: Context<AppEnv>, kind: 'collection' | 'screenshot', targetId: string) {
  const parsed = parseExpiry(await readJson(c.req.raw));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const at = now();

  // Reuse a link that is still live so repeatedly hitting Share doesn't litter
  // the revoke list — an expired link is not live, so it gets replaced.
  const existing = await c.env.DB.prepare(
    `SELECT * FROM share_links
      WHERE kind = ? AND target_id = ? AND revoked = 0
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(kind, targetId, at)
    .first<ShareLinkRow>();

  if (existing) {
    const expiresAt = expiresAtOf(parsed.expiry, existing.expires_at);
    if (parsed.expiry.kind !== 'unset') {
      await c.env.DB.prepare('UPDATE share_links SET expires_at = ? WHERE token = ?')
        .bind(expiresAt, existing.token)
        .run();
    }
    return c.json({
      token: existing.token,
      kind,
      target_id: targetId,
      expires_at: expiresAt,
      url: `${webBase(c.env, c.req.raw)}/p/${existing.token}`,
    });
  }

  const token = shareToken();
  const expiresAt = expiresAtOf(parsed.expiry, null);
  await c.env.DB.prepare(
    `INSERT INTO share_links (token, kind, target_id, created_by, revoked, created_at, expires_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(token, kind, targetId, c.get('identity').actor, at, expiresAt)
    .run();

  return c.json(
    {
      token,
      kind,
      target_id: targetId,
      expires_at: expiresAt,
      url: `${webBase(c.env, c.req.raw)}/p/${token}`,
    },
    201,
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

/**
 * Lists every link that hasn't been revoked, including expired ones — a link
 * that silently vanished from this page would just look like a bug to whoever
 * shared it. Expired rows are flagged so they read as dead, not live.
 */
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
  const at = now();
  return c.json({
    links: (results ?? []).map((l) => ({
      token: l.token,
      kind: l.kind,
      target_id: l.target_id,
      target_label: l.target_label,
      created_by: l.created_by,
      created_at: l.created_at,
      expires_at: l.expires_at,
      expired: hasExpired(l.expires_at, at),
      url: `${base}/p/${l.token}`,
    })),
  });
});

share.delete('/share-links/:token', async (c) => {
  const token = c.req.param('token');
  // An already-revoked token is gone as far as every other route is concerned,
  // so revoking it again is a 404 rather than a silent success. An *expired*
  // link is still revocable — that's how you clear it off the list.
  const existing = await c.env.DB.prepare('SELECT * FROM share_links WHERE token = ? AND revoked = 0')
    .bind(token)
    .first<ShareLinkRow>();
  if (!existing) return c.json({ error: 'share link not found' }, 404);

  await c.env.DB.prepare('UPDATE share_links SET revoked = 1 WHERE token = ?').bind(token).run();
  return c.json({ ok: true });
});
