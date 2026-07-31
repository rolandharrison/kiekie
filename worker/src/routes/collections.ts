import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { webBase } from '../env';
import { collectionId } from '../ids';
import { readJson } from '../json';
import {
  getCollection,
  now,
  shapeAnnotation,
  type AnnotationRow,
  type CollectionRow,
  type ScreenshotRow,
} from '../db';

export const collections = new Hono<AppEnv>();

interface CollectionListRow extends CollectionRow {
  screenshot_count: number;
}

collections.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM screenshots s WHERE s.collection_id = c.id) AS screenshot_count
       FROM collections c
      ORDER BY c.updated_at DESC, c.id DESC`,
  ).all<CollectionListRow>();

  return c.json({ collections: results ?? [] });
});

collections.post('/', async (c) => {
  const body = await readJson(c.req.raw);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return c.json({ error: 'name is required' }, 400);

  const description = typeof body.description === 'string' ? body.description.trim() : null;
  const id = collectionId();
  const ts = now();

  await c.env.DB.prepare(
    'INSERT INTO collections (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, name, description, ts, ts)
    .run();

  return c.json(
    {
      id,
      name,
      description,
      created_at: ts,
      updated_at: ts,
      screenshot_count: 0,
      url: `${webBase(c.env, c.req.raw)}/c/${id}`,
    },
    201,
  );
});

collections.get('/:cid', async (c) => {
  const cid = c.req.param('cid');
  const collection = await getCollection(c.env.DB, cid);
  if (!collection) return c.json({ error: 'collection not found' }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM annotations a WHERE a.screenshot_id = s.id) AS annotation_count,
            (SELECT COUNT(*) FROM annotations a WHERE a.screenshot_id = s.id AND a.resolved = 0) AS open_annotation_count
       FROM screenshots s
      WHERE s.collection_id = ?
      ORDER BY s.created_at DESC, s.id DESC`,
  )
    .bind(cid)
    .all<ScreenshotRow & { annotation_count: number; open_annotation_count: number }>();

  return c.json({ collection, screenshots: results ?? [] });
});

collections.patch('/:cid', async (c) => {
  const cid = c.req.param('cid');
  const existing = await getCollection(c.env.DB, cid);
  if (!existing) return c.json({ error: 'collection not found' }, 404);

  const body = await readJson(c.req.raw);

  let name = existing.name;
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return c.json({ error: 'name must be a non-empty string' }, 400);
    }
    name = body.name.trim();
  }

  let description = existing.description;
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string') {
      return c.json({ error: 'description must be a string or null' }, 400);
    }
    description = body.description === null ? null : (body.description as string).trim() || null;
  }

  const ts = now();
  await c.env.DB.prepare(
    'UPDATE collections SET name = ?, description = ?, updated_at = ? WHERE id = ?',
  )
    .bind(name, description, ts, cid)
    .run();

  return c.json({ ...existing, name, description, updated_at: ts });
});

collections.delete('/:cid', async (c) => {
  const cid = c.req.param('cid');
  const existing = await getCollection(c.env.DB, cid);
  if (!existing) return c.json({ error: 'collection not found' }, 404);

  // Blobs first: a failed R2 delete should not leave orphaned rows pointing at
  // objects that are gone, and orphaned blobs are cheaper than orphaned rows.
  const { results } = await c.env.DB.prepare('SELECT r2_key FROM screenshots WHERE collection_id = ?')
    .bind(cid)
    .all<{ r2_key: string }>();
  const keys = (results ?? []).map((r) => r.r2_key);
  if (keys.length) await c.env.BUCKET.delete(keys);

  await c.env.DB.batch([
    c.env.DB.prepare(
      'DELETE FROM annotations WHERE screenshot_id IN (SELECT id FROM screenshots WHERE collection_id = ?)',
    ).bind(cid),
    c.env.DB.prepare('DELETE FROM screenshots WHERE collection_id = ?').bind(cid),
    c.env.DB.prepare("DELETE FROM share_links WHERE kind = 'collection' AND target_id = ?").bind(cid),
    c.env.DB.prepare('DELETE FROM collections WHERE id = ?').bind(cid),
  ]);

  return c.json({ ok: true, deleted: keys.length });
});

/** All annotations across a collection — powers "apply my feedback" loops. */
collections.get('/:cid/annotations', async (c) => {
  const cid = c.req.param('cid');
  const collection = await getCollection(c.env.DB, cid);
  if (!collection) return c.json({ error: 'collection not found' }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT a.*, s.filename AS screenshot_filename
       FROM annotations a
       JOIN screenshots s ON s.id = a.screenshot_id
      WHERE s.collection_id = ?
      ORDER BY a.created_at ASC, a.id ASC`,
  )
    .bind(cid)
    .all<AnnotationRow & { screenshot_filename: string | null }>();

  return c.json({
    annotations: (results ?? []).map((row) => ({
      ...shapeAnnotation(row),
      screenshot_filename: row.screenshot_filename,
    })),
  });
});
