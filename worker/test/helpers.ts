import {
  env,
  applyD1Migrations,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { beforeEach } from 'vitest';
import worker from '../src/index';

const ORIGIN = 'https://shots.example.com';

/**
 * Storage is shared across tests (see `isolatedStorage: false`), so every test
 * starts by applying the schema — idempotent — and truncating everything.
 */
export function useDatabase() {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM annotations'),
      env.DB.prepare('DELETE FROM screenshots'),
      env.DB.prepare('DELETE FROM share_links'),
      env.DB.prepare('DELETE FROM collections'),
    ]);
    let cursor: string | undefined;
    do {
      const listed = await env.BUCKET.list({ cursor });
      for (const o of listed.objects) await env.BUCKET.delete(o.key);
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  });
}

export async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const request = new Request(`${ORIGIN}${path}`, init);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

export async function api<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const res = await call(path, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body: body as T };
}

export function postJson(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function patchJson(body: unknown): RequestInit {
  return { ...postJson(body), method: 'PATCH' };
}

/** A real 2x1 PNG, so image sniffing has genuine bytes to read. */
export function pngBytes(): Uint8Array {
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEklEQVR4nGP8z8DwnwEJMCELAAB2eQP1DBK/gwAAAABJRU5ErkJggg==';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface CreatedCollection {
  id: string;
  name: string;
  description: string | null;
  url: string;
}

export async function createCollection(
  name = 'UI review',
  description: string | null = 'homepage pass',
): Promise<CreatedCollection> {
  const { status, body } = await api<CreatedCollection>(
    '/api/collections',
    postJson({ name, description }),
  );
  if (status !== 201) throw new Error(`create collection failed: ${status}`);
  return body;
}

export interface CreatedScreenshot {
  id: string;
  collection_id: string;
  r2_key: string;
  width: number;
  height: number;
  url: string;
  image_url: string;
}

export async function uploadScreenshot(
  cid: string,
  filename = 'shot.png',
): Promise<CreatedScreenshot> {
  const form = new FormData();
  form.append('file', new File([pngBytes()], filename, { type: 'image/png' }));
  const { status, body } = await api<CreatedScreenshot>(`/api/collections/${cid}/screenshots`, {
    method: 'POST',
    body: form,
  });
  if (status !== 201) throw new Error(`upload failed: ${status} ${JSON.stringify(body)}`);
  return body;
}
