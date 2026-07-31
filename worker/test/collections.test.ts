import { describe, expect, it } from 'vitest';
import { api, createCollection, patchJson, postJson, uploadScreenshot, useDatabase } from './helpers';

useDatabase();

describe('collections', () => {
  it('creates a collection and returns its web url', async () => {
    const { status, body } = await api('/api/collections', postJson({ name: 'Checkout flow', description: 'v2 redesign' }));
    expect(status).toBe(201);
    expect(body.name).toBe('Checkout flow');
    expect(body.description).toBe('v2 redesign');
    expect(body.id).toMatch(/^[a-z0-9]{6}$/);
    expect(body.url).toBe(`https://shots.example.com/c/${body.id}`);
  });

  it('rejects a missing name', async () => {
    const { status, body } = await api('/api/collections', postJson({ description: 'no name' }));
    expect(status).toBe(400);
    expect(body.error).toMatch(/name/);
  });

  it('lists collections most-recently-updated first with screenshot counts', async () => {
    const first = await createCollection('First', 'a');
    const second = await createCollection('Second', 'b');

    let list = await api('/api/collections');
    expect(list.body.collections.map((c: any) => c.id)).toEqual([second.id, first.id]);

    // Activity on the older collection should float it to the top.
    await uploadScreenshot(first.id);
    list = await api('/api/collections');
    expect(list.body.collections.map((c: any) => c.id)).toEqual([first.id, second.id]);
    expect(list.body.collections[0].screenshot_count).toBe(1);
    expect(list.body.collections[1].screenshot_count).toBe(0);
  });

  it('returns a collection with its screenshots and annotation counts', async () => {
    const col = await createCollection();
    const shot = await uploadScreenshot(col.id, 'home.png');
    await api(`/api/screenshots/${shot.id}/annotations`, postJson({ body: 'first' }));
    await api(`/api/screenshots/${shot.id}/annotations`, postJson({ body: 'second' }));

    const { status, body } = await api(`/api/collections/${col.id}`);
    expect(status).toBe(200);
    expect(body.collection.name).toBe('UI review');
    expect(body.screenshots).toHaveLength(1);
    expect(body.screenshots[0].filename).toBe('home.png');
    expect(body.screenshots[0].annotation_count).toBe(2);
    expect(body.screenshots[0].open_annotation_count).toBe(2);
  });

  it('404s an unknown collection', async () => {
    expect((await api('/api/collections/zzzzzz')).status).toBe(404);
  });

  it('patches name and description', async () => {
    const col = await createCollection();
    const { status, body } = await api(`/api/collections/${col.id}`, patchJson({ name: 'Renamed', description: 'new purpose' }));
    expect(status).toBe(200);
    expect(body.name).toBe('Renamed');
    expect(body.description).toBe('new purpose');

    const bad = await api(`/api/collections/${col.id}`, patchJson({ name: '   ' }));
    expect(bad.status).toBe(400);
  });

  it('clears a description when set to null', async () => {
    const col = await createCollection();
    const { body } = await api(`/api/collections/${col.id}`, patchJson({ description: null }));
    expect(body.description).toBeNull();
  });

  it('deletes a collection, its screenshots, annotations and blobs', async () => {
    const col = await createCollection();
    const shot = await uploadScreenshot(col.id);
    await api(`/api/screenshots/${shot.id}/annotations`, postJson({ body: 'note' }));

    const del = await api(`/api/collections/${col.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(1);

    expect((await api(`/api/collections/${col.id}`)).status).toBe(404);
    expect((await api(`/api/screenshots/${shot.id}`)).status).toBe(404);
    expect((await api(`/img/${shot.r2_key}`)).status).toBe(404);
  });

  it('gathers every annotation across a collection', async () => {
    const col = await createCollection();
    const a = await uploadScreenshot(col.id, 'a.png');
    const b = await uploadScreenshot(col.id, 'b.png');
    await api(`/api/screenshots/${a.id}/annotations`, postJson({ body: 'on a' }));
    await api(`/api/screenshots/${b.id}/annotations`, postJson({ body: 'on b', x: 0.1, y: 0.2, w: 0.3, h: 0.4 }));

    const { status, body } = await api(`/api/collections/${col.id}/annotations`);
    expect(status).toBe(200);
    expect(body.annotations).toHaveLength(2);
    const withRegion = body.annotations.find((x: any) => x.body === 'on b');
    expect(withRegion.screenshot_filename).toBe('b.png');
    expect(withRegion.x).toBeCloseTo(0.1);
  });
});
