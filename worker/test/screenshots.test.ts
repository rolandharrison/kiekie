import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import {
  api,
  call,
  createCollection,
  patchJson,
  pngBytes,
  postJson,
  uploadScreenshot,
  useDatabase,
} from './helpers';

useDatabase();

describe('screenshot upload', () => {
  it('stores the blob, records sniffed dimensions and returns web urls', async () => {
    const col = await createCollection();
    const form = new FormData();
    form.append('file', new File([pngBytes()], 'login.png', { type: 'image/png' }));
    form.append('source_host', 'roland-laptop');

    const { status, body } = await api(`/api/collections/${col.id}/screenshots`, {
      method: 'POST',
      body: form,
    });

    expect(status).toBe(201);
    expect(body.width).toBe(2);
    expect(body.height).toBe(1);
    expect(body.content_type).toBe('image/png');
    expect(body.source_host).toBe('roland-laptop');
    expect(body.r2_key).toBe(`${col.id}/${body.id}.png`);
    expect(body.url).toBe(`https://shots.example.com/c/${col.id}/s/${body.id}`);
    expect(body.image_url).toBe(`https://shots.example.com/img/${body.r2_key}`);

    const object = await env.BUCKET.get(body.r2_key);
    expect(object).not.toBeNull();
  });

  it('bumps the collection updated_at', async () => {
    const col = await createCollection();
    const before = (await api(`/api/collections/${col.id}`)).body.collection.updated_at;
    await uploadScreenshot(col.id);
    const after = (await api(`/api/collections/${col.id}`)).body.collection.updated_at;
    expect(after >= before).toBe(true);
  });

  it('rejects a non-image upload', async () => {
    const col = await createCollection();
    const form = new FormData();
    form.append('file', new File(['not an image at all'], 'notes.txt', { type: 'text/plain' }));
    const { status, body } = await api(`/api/collections/${col.id}/screenshots`, {
      method: 'POST',
      body: form,
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/image/);
  });

  it('rejects an SVG even when declared as an image type', async () => {
    // The declared content type must never be trusted: an SVG stored and later
    // served inline as image/svg+xml would be stored XSS on this origin.
    const col = await createCollection();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const form = new FormData();
    form.append('file', new File([svg], 'evil.svg', { type: 'image/svg+xml' }));
    const { status } = await api(`/api/collections/${col.id}/screenshots`, {
      method: 'POST',
      body: form,
    });
    expect(status).toBe(400);
  });

  it('rejects an empty file and a missing file', async () => {
    const col = await createCollection();

    const empty = new FormData();
    empty.append('file', new File([], 'empty.png', { type: 'image/png' }));
    expect((await api(`/api/collections/${col.id}/screenshots`, { method: 'POST', body: empty })).status).toBe(400);

    const none = new FormData();
    none.append('note', 'hello');
    expect((await api(`/api/collections/${col.id}/screenshots`, { method: 'POST', body: none })).status).toBe(400);
  });

  it('404s uploading to an unknown collection', async () => {
    const form = new FormData();
    form.append('file', new File([pngBytes()], 'x.png', { type: 'image/png' }));
    expect((await api('/api/collections/nope00/screenshots', { method: 'POST', body: form })).status).toBe(404);
  });
});

describe('screenshot read / move / delete', () => {
  it('returns metadata with its collection and annotations', async () => {
    const col = await createCollection();
    const shot = await uploadScreenshot(col.id, 'home.png');
    await api(`/api/screenshots/${shot.id}/annotations`, postJson({ body: 'looks off' }));

    const { status, body } = await api(`/api/screenshots/${shot.id}`);
    expect(status).toBe(200);
    expect(body.screenshot.filename).toBe('home.png');
    expect(body.collection.id).toBe(col.id);
    expect(body.annotations).toHaveLength(1);
    expect(body.annotations[0].body).toBe('looks off');
  });

  it('moves a screenshot between collections and touches both', async () => {
    const a = await createCollection('A', null);
    const b = await createCollection('B', null);
    const shot = await uploadScreenshot(a.id);

    const { status, body } = await api(`/api/screenshots/${shot.id}`, patchJson({ collection_id: b.id }));
    expect(status).toBe(200);
    expect(body.screenshot.collection_id).toBe(b.id);

    expect((await api(`/api/collections/${a.id}`)).body.screenshots).toHaveLength(0);
    expect((await api(`/api/collections/${b.id}`)).body.screenshots).toHaveLength(1);
  });

  it('404s a move to an unknown collection', async () => {
    const col = await createCollection();
    const shot = await uploadScreenshot(col.id);
    const { status } = await api(`/api/screenshots/${shot.id}`, patchJson({ collection_id: 'zzzzzz' }));
    expect(status).toBe(404);
  });

  it('deletes the row, its annotations and the blob', async () => {
    const col = await createCollection();
    const shot = await uploadScreenshot(col.id);
    const anno = await api(`/api/screenshots/${shot.id}/annotations`, postJson({ body: 'note' }));

    expect((await api(`/api/screenshots/${shot.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await api(`/api/screenshots/${shot.id}`)).status).toBe(404);
    expect(await env.BUCKET.get(shot.r2_key)).toBeNull();
    expect((await api(`/api/annotations/${anno.body.annotation.id}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('image streaming', () => {
  it('streams the blob with an immutable private cache header', async () => {
    const col = await createCollection();
    const shot = await uploadScreenshot(col.id);

    const res = await call(`/img/${shot.r2_key}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('private');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(pngBytes());
  });

  it('404s a bucket object with no screenshot row', async () => {
    // /img must not be a read primitive for arbitrary bucket keys.
    await env.BUCKET.put('stray/object.png', pngBytes());
    expect((await call('/img/stray/object.png')).status).toBe(404);
  });

  it('revalidates with etag', async () => {
    const col = await createCollection();
    const shot = await uploadScreenshot(col.id);
    const first = await call(`/img/${shot.r2_key}`);
    const etag = first.headers.get('etag')!;
    const second = await call(`/img/${shot.r2_key}`, { headers: { 'if-none-match': etag } });
    expect(second.status).toBe(304);
  });

  it('404s an unknown key', async () => {
    expect((await call('/img/nope/nope.png')).status).toBe(404);
  });
});
