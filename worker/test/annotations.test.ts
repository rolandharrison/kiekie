import { describe, expect, it } from 'vitest';
import { api, createCollection, patchJson, postJson, uploadScreenshot, useDatabase } from './helpers';

useDatabase();

async function subject() {
  const col = await createCollection();
  const shot = await uploadScreenshot(col.id);
  return { col, shot };
}

describe('annotations', () => {
  it('creates a whole-image comment attributed to the caller', async () => {
    const { shot } = await subject();
    const { status, body } = await api(`/api/screenshots/${shot.id}/annotations`, postJson({ body: '  spacing is off  ' }));

    expect(status).toBe(201);
    expect(body.annotation.body).toBe('spacing is off');
    expect(body.annotation.author).toBe('tester@example.com');
    expect(body.annotation.resolved).toBe(false);
    expect(body.annotation.x).toBeNull();
  });

  it('creates a pin (zero-size region) and a rectangle', async () => {
    const { shot } = await subject();

    const pin = await api(`/api/screenshots/${shot.id}/annotations`, postJson({ body: 'here', x: 0.5, y: 0.25, w: 0, h: 0 }));
    expect(pin.status).toBe(201);
    expect(pin.body.annotation.x).toBeCloseTo(0.5);
    expect(pin.body.annotation.w).toBe(0);

    const rect = await api(`/api/screenshots/${shot.id}/annotations`, postJson({ body: 'this block', x: 0.1, y: 0.1, w: 0.4, h: 0.2 }));
    expect(rect.status).toBe(201);
    expect(rect.body.annotation.h).toBeCloseTo(0.2);
  });

  it('rejects an empty body', async () => {
    const { shot } = await subject();
    const { status, body } = await api(`/api/screenshots/${shot.id}/annotations`, postJson({ body: '   ' }));
    expect(status).toBe(400);
    expect(body.error).toMatch(/body/);
  });

  it.each([
    [{ body: 'x', x: 0.1 }, /all of x, y, w, h/],
    [{ body: 'x', x: 0.1, y: 0.1, w: 0.1 }, /all of x, y, w, h/],
    [{ body: 'x', x: -0.1, y: 0.1, w: 0.1, h: 0.1 }, /normalised/],
    [{ body: 'x', x: 0.1, y: 1.5, w: 0.1, h: 0.1 }, /normalised/],
    [{ body: 'x', x: 0.9, y: 0.1, w: 0.5, h: 0.1 }, /past the image bounds/],
    [{ body: 'x', x: 'a', y: 0.1, w: 0.1, h: 0.1 }, /must be a number/],
  ])('rejects invalid region %j', async (payload, expected) => {
    const { shot } = await subject();
    const { status, body } = await api(`/api/screenshots/${shot.id}/annotations`, postJson(payload));
    expect(status).toBe(400);
    expect(body.error).toMatch(expected);
  });

  it('404s annotating an unknown screenshot', async () => {
    expect((await api('/api/screenshots/zzzzzzzz/annotations', postJson({ body: 'x' }))).status).toBe(404);
    expect((await api('/api/screenshots/zzzzzzzz/annotations')).status).toBe(404);
  });

  it('lists annotations oldest first', async () => {
    const { shot } = await subject();
    await api(`/api/screenshots/${shot.id}/annotations`, postJson({ body: 'one' }));
    await api(`/api/screenshots/${shot.id}/annotations`, postJson({ body: 'two' }));

    const { body } = await api(`/api/screenshots/${shot.id}/annotations`);
    expect(body.annotations.map((a: any) => a.body)).toEqual(['one', 'two']);
  });

  it('edits and resolves', async () => {
    const { shot } = await subject();
    const created = await api(`/api/screenshots/${shot.id}/annotations`, postJson({ body: 'origin' }));
    const aid = created.body.annotation.id;

    const edited = await api(`/api/annotations/${aid}`, patchJson({ body: 'revised' }));
    expect(edited.body.annotation.body).toBe('revised');
    expect(edited.body.annotation.resolved).toBe(false);

    const resolved = await api(`/api/annotations/${aid}`, patchJson({ resolved: true }));
    expect(resolved.body.annotation.resolved).toBe(true);
    expect(resolved.body.annotation.body).toBe('revised');

    const unresolved = await api(`/api/annotations/${aid}`, patchJson({ resolved: false }));
    expect(unresolved.body.annotation.resolved).toBe(false);
  });

  it('rejects bad patch payloads', async () => {
    const { shot } = await subject();
    const created = await api(`/api/screenshots/${shot.id}/annotations`, postJson({ body: 'origin' }));
    const aid = created.body.annotation.id;

    expect((await api(`/api/annotations/${aid}`, patchJson({ body: '' }))).status).toBe(400);
    expect((await api(`/api/annotations/${aid}`, patchJson({ resolved: 'yes' }))).status).toBe(400);
  });

  it('deletes', async () => {
    const { shot } = await subject();
    const created = await api(`/api/screenshots/${shot.id}/annotations`, postJson({ body: 'gone soon' }));
    const aid = created.body.annotation.id;

    expect((await api(`/api/annotations/${aid}`, { method: 'DELETE' })).status).toBe(200);
    expect((await api(`/api/annotations/${aid}`, { method: 'DELETE' })).status).toBe(404);
    expect((await api(`/api/screenshots/${shot.id}/annotations`)).body.annotations).toHaveLength(0);
  });

  it('bumps the parent collection so annotated work resurfaces', async () => {
    const { col, shot } = await subject();
    const other = await createCollection('Other', null);
    expect((await api('/api/collections')).body.collections[0].id).toBe(other.id);

    await api(`/api/screenshots/${shot.id}/annotations`, postJson({ body: 'feedback' }));
    expect((await api('/api/collections')).body.collections[0].id).toBe(col.id);
  });
});
