import { describe, expect, it } from 'vitest';
import { api, call, createCollection, pngBytes, postJson, uploadScreenshot, useDatabase } from './helpers';

useDatabase();

describe('share links', () => {
  it('mints a collection link and reuses it while live', async () => {
    const col = await createCollection();
    const first = await api(`/api/collections/${col.id}/share`, { method: 'POST' });
    expect(first.status).toBe(201);
    expect(first.body.token).toHaveLength(21);
    expect(first.body.url).toBe(`https://shots.example.com/p/${first.body.token}`);

    const second = await api(`/api/collections/${col.id}/share`, { method: 'POST' });
    expect(second.status).toBe(200);
    expect(second.body.token).toBe(first.body.token);
  });

  it('mints a screenshot link', async () => {
    const col = await createCollection();
    const shot = await uploadScreenshot(col.id);
    const { status, body } = await api(`/api/screenshots/${shot.id}/share`, { method: 'POST' });
    expect(status).toBe(201);
    expect(body.kind).toBe('screenshot');
  });

  it('404s sharing something that does not exist', async () => {
    expect((await api('/api/collections/zzzzzz/share', { method: 'POST' })).status).toBe(404);
    expect((await api('/api/screenshots/zzzzzzzz/share', { method: 'POST' })).status).toBe(404);
  });

  it('lists live links with their target label and creator', async () => {
    const col = await createCollection('Design pass', null);
    await api(`/api/collections/${col.id}/share`, { method: 'POST' });

    const { body } = await api('/api/share-links');
    expect(body.links).toHaveLength(1);
    expect(body.links[0].target_label).toBe('Design pass');
    expect(body.links[0].created_by).toBe('tester@example.com');
  });

  it('revokes a link and drops it from the list', async () => {
    const col = await createCollection();
    const { body } = await api(`/api/collections/${col.id}/share`, { method: 'POST' });

    expect((await api(`/api/share-links/${body.token}`, { method: 'DELETE' })).status).toBe(200);
    expect((await api('/api/share-links')).body.links).toHaveLength(0);
    expect((await api(`/api/share-links/${body.token}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('public share routes', () => {
  it('serves collection data and images without auth', async () => {
    const col = await createCollection('Shared', 'for the client');
    const shot = await uploadScreenshot(col.id, 'hero.png');
    await api(`/api/screenshots/${shot.id}/annotations`, postJson({ body: 'public note', x: 0.1, y: 0.1, w: 0.2, h: 0.2 }));
    const { body: link } = await api(`/api/collections/${col.id}/share`, { method: 'POST' });

    const data = await api(`/p/${link.token}/data`);
    expect(data.status).toBe(200);
    expect(data.body.kind).toBe('collection');
    expect(data.body.collection.name).toBe('Shared');
    expect(data.body.screenshots).toHaveLength(1);
    expect(data.body.annotations[0].body).toBe('public note');

    const image = await call(`/p/${link.token}/img/${shot.r2_key}`);
    expect(image.status).toBe(200);
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(pngBytes());

    const page = await call(`/p/${link.token}`);
    expect(page.status).toBe(200);
  });

  it('serves a single-screenshot link', async () => {
    const col = await createCollection();
    const a = await uploadScreenshot(col.id, 'a.png');
    const b = await uploadScreenshot(col.id, 'b.png');
    const { body: link } = await api(`/api/screenshots/${a.id}/share`, { method: 'POST' });

    const data = await api(`/p/${link.token}/data`);
    expect(data.body.kind).toBe('screenshot');
    expect(data.body.screenshots.map((s: any) => s.id)).toEqual([a.id]);

    // A screenshot token must not unlock its sibling in the same collection.
    expect((await call(`/p/${link.token}/img/${b.r2_key}`)).status).toBe(404);
  });

  it('scopes image access to the shared collection', async () => {
    const shared = await createCollection('Shared', null);
    const secret = await createCollection('Secret', null);
    const secretShot = await uploadScreenshot(secret.id, 'private.png');
    const { body: link } = await api(`/api/collections/${shared.id}/share`, { method: 'POST' });

    expect((await call(`/p/${link.token}/img/${secretShot.r2_key}`)).status).toBe(404);
  });

  it('404s once revoked', async () => {
    const col = await createCollection();
    const shot = await uploadScreenshot(col.id);
    const { body: link } = await api(`/api/collections/${col.id}/share`, { method: 'POST' });
    await api(`/api/share-links/${link.token}`, { method: 'DELETE' });

    expect((await call(`/p/${link.token}`)).status).toBe(404);
    expect((await api(`/p/${link.token}/data`)).status).toBe(404);
    expect((await call(`/p/${link.token}/img/${shot.r2_key}`)).status).toBe(404);
  });

  it('404s an unknown token', async () => {
    expect((await api('/p/not-a-real-token/data')).status).toBe(404);
  });

  it('exposes no write verbs at all', async () => {
    const col = await createCollection();
    const shot = await uploadScreenshot(col.id);
    const { body: link } = await api(`/api/collections/${col.id}/share`, { method: 'POST' });

    for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) {
      const res = await call(`/p/${link.token}/data`, { method });
      expect(res.status, `${method} /p/:token/data`).toBe(404);
      const anno = await call(`/p/${link.token}/annotations`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'DELETE' ? undefined : JSON.stringify({ body: 'sneaky' }),
      });
      expect(anno.status, `${method} /p/:token/annotations`).toBe(404);
    }

    // And the authenticated write path is genuinely closed to a public visitor.
    expect((await api(`/api/screenshots/${shot.id}/annotations`)).body.annotations).toHaveLength(0);
  });
});
