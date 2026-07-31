import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { annotationId } from '../ids';
import { readJson } from '../json';
import {
  getAnnotation,
  getScreenshot,
  listAnnotations,
  now,
  shapeAnnotation,
  touchCollectionOfScreenshot,
} from '../db';

export const screenshotAnnotations = new Hono<AppEnv>();

/**
 * A region is either fully absent (whole-image comment) or fully present and
 * normalised to 0–1. A pin is a zero-size rect, so w/h of 0 are valid.
 */
function parseRegion(body: Record<string, unknown>):
  | { ok: true; region: { x: number; y: number; w: number; h: number } | null }
  | { ok: false; error: string } {
  const keys = ['x', 'y', 'w', 'h'] as const;
  const present = keys.filter((k) => body[k] !== undefined && body[k] !== null);
  if (present.length === 0) return { ok: true, region: null };
  if (present.length !== keys.length) {
    return { ok: false, error: 'region requires all of x, y, w, h (or none)' };
  }
  const nums: Record<string, number> = {};
  for (const k of keys) {
    const v = body[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { ok: false, error: `${k} must be a number` };
    }
    if (v < 0 || v > 1) return { ok: false, error: `${k} must be normalised between 0 and 1` };
    nums[k] = v;
  }
  if (nums.x + nums.w > 1.0001 || nums.y + nums.h > 1.0001) {
    return { ok: false, error: 'region extends past the image bounds' };
  }
  return { ok: true, region: { x: nums.x, y: nums.y, w: nums.w, h: nums.h } };
}

screenshotAnnotations.get('/:sid/annotations', async (c) => {
  const sid = c.req.param('sid');
  const shot = await getScreenshot(c.env.DB, sid);
  if (!shot) return c.json({ error: 'screenshot not found' }, 404);
  const rows = await listAnnotations(c.env.DB, sid);
  return c.json({ annotations: rows.map(shapeAnnotation) });
});

screenshotAnnotations.post('/:sid/annotations', async (c) => {
  const sid = c.req.param('sid');
  const shot = await getScreenshot(c.env.DB, sid);
  if (!shot) return c.json({ error: 'screenshot not found' }, 404);

  const body = await readJson(c.req.raw);
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return c.json({ error: 'body is required' }, 400);

  const parsed = parseRegion(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const id = annotationId();
  const ts = now();
  const author = c.get('identity').actor;
  const r = parsed.region;

  await c.env.DB.prepare(
    `INSERT INTO annotations (id, screenshot_id, body, x, y, w, h, author, resolved, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  )
    .bind(id, sid, text, r?.x ?? null, r?.y ?? null, r?.w ?? null, r?.h ?? null, author, ts)
    .run();

  await touchCollectionOfScreenshot(c.env.DB, sid);

  const row = await getAnnotation(c.env.DB, id);
  return c.json({ annotation: shapeAnnotation(row!) }, 201);
});

export const annotations = new Hono<AppEnv>();

annotations.patch('/:aid', async (c) => {
  const aid = c.req.param('aid');
  const existing = await getAnnotation(c.env.DB, aid);
  if (!existing) return c.json({ error: 'annotation not found' }, 404);

  const body = await readJson(c.req.raw);

  let text = existing.body;
  if (body.body !== undefined) {
    if (typeof body.body !== 'string' || !body.body.trim()) {
      return c.json({ error: 'body must be a non-empty string' }, 400);
    }
    text = body.body.trim();
  }

  let resolved = existing.resolved;
  if (body.resolved !== undefined) {
    if (typeof body.resolved !== 'boolean') {
      return c.json({ error: 'resolved must be a boolean' }, 400);
    }
    resolved = body.resolved ? 1 : 0;
  }

  await c.env.DB.prepare('UPDATE annotations SET body = ?, resolved = ? WHERE id = ?')
    .bind(text, resolved, aid)
    .run();
  await touchCollectionOfScreenshot(c.env.DB, existing.screenshot_id);

  const row = await getAnnotation(c.env.DB, aid);
  return c.json({ annotation: shapeAnnotation(row!) });
});

annotations.delete('/:aid', async (c) => {
  const aid = c.req.param('aid');
  const existing = await getAnnotation(c.env.DB, aid);
  if (!existing) return c.json({ error: 'annotation not found' }, 404);

  await c.env.DB.prepare('DELETE FROM annotations WHERE id = ?').bind(aid).run();
  await touchCollectionOfScreenshot(c.env.DB, existing.screenshot_id);

  return c.json({ ok: true });
});
