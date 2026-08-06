export interface CollectionRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScreenshotRow {
  id: string;
  collection_id: string;
  r2_key: string;
  filename: string | null;
  description: string | null;
  content_type: string | null;
  width: number | null;
  height: number | null;
  source_host: string | null;
  created_at: string;
}

export interface AnnotationRow {
  id: string;
  screenshot_id: string;
  body: string;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  author: string | null;
  resolved: number;
  created_at: string;
}

export interface ShareLinkRow {
  token: string;
  kind: 'collection' | 'screenshot';
  target_id: string;
  created_by: string | null;
  revoked: number;
  created_at: string;
  /** NULL means the link never expires. */
  expires_at: string | null;
}

/**
 * Timestamps are generated here rather than by SQLite's `datetime('now')` so they
 * carry milliseconds — the column default is second-resolution, which makes
 * "most recently updated first" ordering ambiguous when several writes land in
 * the same second (exactly what tests and rapid MCP uploads do).
 *
 * Milliseconds alone still tie: Workers freeze `Date.now()` for the duration of
 * a request, so two writes in one request stamp identically and recency order
 * falls through to the random-id tiebreaker. Each call therefore returns at
 * least 1ms more than the last one this isolate handed out.
 */
let lastMs = 0;
export function now(): string {
  lastMs = Math.max(Date.now(), lastMs + 1);
  return stamp(new Date(lastMs));
}

function stamp(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

/** A timestamp `days` from now, in the same sortable format as `now()`. */
export function inDays(days: number): string {
  return stamp(new Date(Date.now() + days * 86_400_000));
}

/**
 * Expiry is compared as a string: every timestamp this app writes uses the same
 * fixed-width UTC format, so lexicographic order is chronological order.
 */
export function hasExpired(expiresAt: string | null, at = now()): boolean {
  return expiresAt !== null && expiresAt <= at;
}

export async function getCollection(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM collections WHERE id = ?').bind(id).first<CollectionRow>();
}

export async function getScreenshot(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM screenshots WHERE id = ?').bind(id).first<ScreenshotRow>();
}

export async function getAnnotation(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM annotations WHERE id = ?').bind(id).first<AnnotationRow>();
}

export async function listAnnotations(db: D1Database, screenshotId: string) {
  const { results } = await db
    .prepare('SELECT * FROM annotations WHERE screenshot_id = ? ORDER BY created_at ASC, id ASC')
    .bind(screenshotId)
    .all<AnnotationRow>();
  return results ?? [];
}

/**
 * Collections are ordered by recency of *activity*, so every screenshot add,
 * screenshot delete and annotation write bumps this.
 */
export async function touchCollection(db: D1Database, id: string) {
  await db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').bind(now(), id).run();
}

export async function touchCollectionOfScreenshot(db: D1Database, screenshotId: string) {
  await db
    .prepare(
      'UPDATE collections SET updated_at = ? ' +
        'WHERE id = (SELECT collection_id FROM screenshots WHERE id = ?)',
    )
    .bind(now(), screenshotId)
    .run();
}

export function shapeAnnotation(row: AnnotationRow) {
  return {
    id: row.id,
    screenshot_id: row.screenshot_id,
    body: row.body,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    author: row.author,
    resolved: row.resolved === 1,
    created_at: row.created_at,
  };
}
