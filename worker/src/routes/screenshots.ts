import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { webBase } from '../env';
import { screenshotId } from '../ids';
import { extensionFor, sniffImage } from '../images';
import { readJson } from '../json';
import {
  getCollection,
  getScreenshot,
  listAnnotations,
  now,
  shapeAnnotation,
  touchCollection,
  type ScreenshotRow,
} from '../db';

/** 25 MB — comfortably above any screenshot, well under the Worker body limit. */
const MAX_BYTES = 25 * 1024 * 1024;

export const uploads = new Hono<AppEnv>();

uploads.post('/:cid/screenshots', async (c) => {
  const cid = c.req.param('cid');
  const collection = await getCollection(c.env.DB, cid);
  if (!collection) return c.json({ error: 'collection not found' }, 404);

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: 'expected multipart/form-data with a "file" field' }, 400);
  }

  const entry = form.get('file') as File | string | null;
  if (!entry || typeof entry === 'string') {
    return c.json({ error: 'file is required' }, 400);
  }
  const file: File = entry;

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) return c.json({ error: 'file is empty' }, 400);
  if (bytes.byteLength > MAX_BYTES) return c.json({ error: 'file too large (max 25MB)' }, 413);

  const formName = form.get('filename');
  const filename =
    (typeof formName === 'string' && formName.trim()) || file.name || 'screenshot.png';

  // Only formats verified by magic bytes are accepted — the caller-declared
  // type is never trusted. Trusting it would let an "image/svg+xml" upload
  // through, and an SVG served inline from /img is script running on this
  // origin (stored XSS), reachable login-free via /p/{token}/img.
  const sniffed = sniffImage(bytes);
  const contentType = sniffed.contentType;
  if (!contentType) {
    return c.json({ error: 'unsupported file type; expected a PNG, JPEG, GIF or WebP image' }, 400);
  }

  const sourceHostRaw = form.get('source_host');
  const sourceHost = typeof sourceHostRaw === 'string' && sourceHostRaw.trim() ? sourceHostRaw.trim() : null;

  const descriptionRaw = form.get('description');
  const description =
    typeof descriptionRaw === 'string' && descriptionRaw.trim() ? descriptionRaw.trim() : null;

  const sid = screenshotId();
  const key = `${cid}/${sid}.${extensionFor(contentType, filename)}`;

  await c.env.BUCKET.put(key, bytes, { httpMetadata: { contentType } });

  const ts = now();
  await c.env.DB.prepare(
    `INSERT INTO screenshots
       (id, collection_id, r2_key, filename, description, content_type, width, height, source_host, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(sid, cid, key, filename, description, contentType, sniffed.width, sniffed.height, sourceHost, ts)
    .run();

  await touchCollection(c.env.DB, cid);

  const base = webBase(c.env, c.req.raw);
  return c.json(
    {
      id: sid,
      collection_id: cid,
      r2_key: key,
      filename,
      description,
      content_type: contentType,
      width: sniffed.width,
      height: sniffed.height,
      source_host: sourceHost,
      created_at: ts,
      url: `${base}/c/${cid}/s/${sid}`,
      image_url: `${base}/img/${key}`,
    },
    201,
  );
});

export const screenshots = new Hono<AppEnv>();

screenshots.get('/:sid', async (c) => {
  const sid = c.req.param('sid');
  const shot = await getScreenshot(c.env.DB, sid);
  if (!shot) return c.json({ error: 'screenshot not found' }, 404);

  const collection = await getCollection(c.env.DB, shot.collection_id);
  const rows = await listAnnotations(c.env.DB, sid);

  return c.json({
    screenshot: shot,
    collection,
    annotations: rows.map(shapeAnnotation),
  });
});

/** Move a screenshot between collections. */
screenshots.patch('/:sid', async (c) => {
  const sid = c.req.param('sid');
  const shot = await getScreenshot(c.env.DB, sid);
  if (!shot) return c.json({ error: 'screenshot not found' }, 404);

  const body = await readJson(c.req.raw);

  let collectionId = shot.collection_id;
  if (body.collection_id !== undefined) {
    if (typeof body.collection_id !== 'string' || !body.collection_id.trim()) {
      return c.json({ error: 'collection_id must be a string' }, 400);
    }
    const target = await getCollection(c.env.DB, body.collection_id);
    if (!target) return c.json({ error: 'target collection not found' }, 404);
    collectionId = target.id;
  }

  let filename = shot.filename;
  if (body.filename !== undefined) {
    if (typeof body.filename !== 'string' || !body.filename.trim()) {
      return c.json({ error: 'filename must be a non-empty string' }, 400);
    }
    filename = body.filename.trim();
  }

  // null clears the description; a string sets it.
  let description = shot.description;
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string') {
      return c.json({ error: 'description must be a string or null' }, 400);
    }
    description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null;
  }

  await c.env.DB.prepare(
    'UPDATE screenshots SET collection_id = ?, filename = ?, description = ? WHERE id = ?',
  )
    .bind(collectionId, filename, description, sid)
    .run();

  // Both ends of a move changed, so both surface as recently active.
  await touchCollection(c.env.DB, collectionId);
  if (collectionId !== shot.collection_id) await touchCollection(c.env.DB, shot.collection_id);

  const updated = (await getScreenshot(c.env.DB, sid)) as ScreenshotRow;
  return c.json({ screenshot: updated });
});

screenshots.delete('/:sid', async (c) => {
  const sid = c.req.param('sid');
  const shot = await getScreenshot(c.env.DB, sid);
  if (!shot) return c.json({ error: 'screenshot not found' }, 404);

  await c.env.BUCKET.delete(shot.r2_key);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM annotations WHERE screenshot_id = ?').bind(sid),
    c.env.DB.prepare("DELETE FROM share_links WHERE kind = 'screenshot' AND target_id = ?").bind(sid),
    c.env.DB.prepare('DELETE FROM screenshots WHERE id = ?').bind(sid),
  ]);
  await touchCollection(c.env.DB, shot.collection_id);

  return c.json({ ok: true });
});
