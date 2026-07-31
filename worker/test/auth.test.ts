import { afterEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { api, call, createCollection, postJson, useDatabase } from './helpers';

useDatabase();

const original = { trust: env.TRUST_ACCESS_HEADERS, dev: env.DEV_IDENTITY };

afterEach(() => {
  env.TRUST_ACCESS_HEADERS = original.trust;
  env.DEV_IDENTITY = original.dev;
});

/** Behind Access in production; header-trusting mode. */
function behindAccess() {
  env.TRUST_ACCESS_HEADERS = '1';
  env.DEV_IDENTITY = '';
}

describe('auth', () => {
  it('reports the dev identity in local mode', async () => {
    const { status, body } = await api('/api/me');
    expect(status).toBe(200);
    expect(body.identity).toEqual({ actor: 'tester@example.com', kind: 'user' });
  });

  it('401s every API route with no resolvable identity', async () => {
    env.TRUST_ACCESS_HEADERS = '';
    env.DEV_IDENTITY = '';
    for (const path of ['/api/me', '/api/collections', '/api/share-links']) {
      const res = await call(path);
      expect(res.status, path).toBe(401);
    }
    expect((await api('/api/collections', postJson({ name: 'x' }))).status).toBe(401);
  });

  it('401s image streaming with no identity', async () => {
    env.TRUST_ACCESS_HEADERS = '';
    env.DEV_IDENTITY = '';
    expect((await call('/img/some/key.png')).status).toBe(401);
  });

  it('accepts an Access-authenticated browser user', async () => {
    behindAccess();
    const { status, body } = await api('/api/me', {
      headers: { 'Cf-Access-Authenticated-User-Email': 'roland@example.com' },
    });
    expect(status).toBe(200);
    expect(body.identity).toEqual({ actor: 'roland@example.com', kind: 'user' });
  });

  it('accepts an Access service token and labels it as a service', async () => {
    behindAccess();
    const { status, body } = await api('/api/me', {
      headers: {
        'CF-Access-Client-Id': 'abc123.access',
        'CF-Access-Client-Secret': 'shh',
      },
    });
    expect(status).toBe(200);
    expect(body.identity).toEqual({ actor: 'service:abc123.access', kind: 'service' });
  });

  it('rejects a service token missing its secret', async () => {
    behindAccess();
    expect((await call('/api/me', { headers: { 'CF-Access-Client-Id': 'abc123.access' } })).status).toBe(401);
  });

  it('ignores Access headers when not deployed behind Access', async () => {
    // Without TRUST_ACCESS_HEADERS a client could otherwise forge any identity.
    env.TRUST_ACCESS_HEADERS = '';
    env.DEV_IDENTITY = '';
    const res = await call('/api/me', {
      headers: { 'Cf-Access-Authenticated-User-Email': 'attacker@evil.example' },
    });
    expect(res.status).toBe(401);
  });

  it('attributes annotations to the authenticated user', async () => {
    behindAccess();
    const headers = { 'Cf-Access-Authenticated-User-Email': 'roland@example.com' };

    const col = await api('/api/collections', { ...postJson({ name: 'Auth', description: null }), headers: { ...headers, 'content-type': 'application/json' } });
    const form = new FormData();
    form.append('file', new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2, 0, 0, 0, 1])], 's.png', { type: 'image/png' }));
    const shot = await api(`/api/collections/${col.body.id}/screenshots`, { method: 'POST', body: form, headers });

    const anno = await api(`/api/screenshots/${shot.body.id}/annotations`, {
      ...postJson({ body: 'mine' }),
      headers: { ...headers, 'content-type': 'application/json' },
    });
    expect(anno.body.annotation.author).toBe('roland@example.com');
  });

  it('leaves public share routes reachable with no identity', async () => {
    const col = await createCollection();
    const { body: link } = await api(`/api/collections/${col.id}/share`, { method: 'POST' });

    env.TRUST_ACCESS_HEADERS = '';
    env.DEV_IDENTITY = '';
    expect((await api(`/p/${link.token}/data`)).status).toBe(200);
  });
});
