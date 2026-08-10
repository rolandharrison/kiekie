import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { api, call, createCollection, pngBytes, postJson, useDatabase } from './helpers';
import { AUD, TEAM_DOMAIN, accessHeaders, mintToken, stubJwks, unstubJwks } from './access-jwt';

useDatabase();

const original = { team: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, dev: env.DEV_IDENTITY };

afterEach(() => {
  env.ACCESS_TEAM_DOMAIN = original.team;
  env.ACCESS_AUD = original.aud;
  env.DEV_IDENTITY = original.dev;
  unstubJwks();
});

/** Put the Worker in production mode: behind a real Access tenant. */
async function behindAccess() {
  env.ACCESS_TEAM_DOMAIN = TEAM_DOMAIN;
  env.ACCESS_AUD = AUD;
  env.DEV_IDENTITY = '';
  await stubJwks();
}

describe('local development mode', () => {
  it('reports the dev identity when no Access tenant is configured', async () => {
    const { status, body } = await api('/api/me');
    expect(status).toBe(200);
    expect(body.identity).toEqual({ actor: 'tester@example.com', kind: 'user' });
  });

  it('401s every API route when there is no identity at all', async () => {
    env.DEV_IDENTITY = '';
    for (const path of ['/api/me', '/api/collections', '/api/share-links']) {
      expect((await call(path)).status, path).toBe(401);
    }
    expect((await api('/api/collections', postJson({ name: 'x' }))).status).toBe(401);
    expect((await call('/img/some/key.png')).status).toBe(401);
  });
});

describe('behind Cloudflare Access', () => {
  beforeEach(behindAccess);

  it('accepts a signed assertion for a human and uses the email claim', async () => {
    const token = await mintToken({ email: 'roland@example.com' });
    const { status, body } = await api('/api/me', { headers: accessHeaders(token) });
    expect(status).toBe(200);
    expect(body.identity).toEqual({ actor: 'roland@example.com', kind: 'user' });
  });

  it('accepts a service token assertion via its common_name claim', async () => {
    // This is how the MCP server authenticates: Access consumes the
    // CF-Access-Client-* headers and mints an assertion with no email.
    const token = await mintToken({ commonName: 'b3fbe092.access' });
    const { status, body } = await api('/api/me', { headers: accessHeaders(token) });
    expect(status).toBe(200);
    expect(body.identity).toEqual({ actor: 'service:b3fbe092.access', kind: 'service' });
  });

  it('reads the assertion from the CF_Authorization cookie too', async () => {
    const token = await mintToken({ email: 'roland@example.com' });
    const { status } = await api('/api/me', { headers: { cookie: `CF_Authorization=${token}` } });
    expect(status).toBe(200);
  });

  it('rejects a request with no assertion', async () => {
    expect((await call('/api/me')).status).toBe(401);
  });

  it('ignores the legacy plaintext identity headers', async () => {
    // Access consumes these; anything arriving in them is attacker-supplied.
    const res = await call('/api/me', {
      headers: {
        'Cf-Access-Authenticated-User-Email': 'attacker@evil.example',
        'CF-Access-Client-Id': 'forged.access',
        'CF-Access-Client-Secret': 'forged',
      },
    });
    expect(res.status).toBe(401);
  });

  it('rejects a tampered signature', async () => {
    const token = await mintToken({ email: 'roland@example.com', tamper: true });
    expect((await call('/api/me', { headers: accessHeaders(token) })).status).toBe(401);
  });

  it('rejects a token signed by a key outside the tenant JWKS', async () => {
    const token = await mintToken({ email: 'roland@example.com', wrongKey: true });
    expect((await call('/api/me', { headers: accessHeaders(token) })).status).toBe(401);
  });

  it('rejects a token minted for a different Access application', async () => {
    const token = await mintToken({ email: 'roland@example.com', aud: 'some-other-app' });
    expect((await call('/api/me', { headers: accessHeaders(token) })).status).toBe(401);
  });

  it('rejects a token from a different issuer', async () => {
    const token = await mintToken({ email: 'roland@example.com', iss: 'https://evil.cloudflareaccess.com' });
    expect((await call('/api/me', { headers: accessHeaders(token) })).status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    const token = await mintToken({ email: 'roland@example.com', exp: past });
    expect((await call('/api/me', { headers: accessHeaders(token) })).status).toBe(401);
  });

  it('rejects a not-yet-valid token', async () => {
    const future = Math.floor(Date.now() / 1000) + 7200;
    const token = await mintToken({ email: 'roland@example.com', nbf: future });
    expect((await call('/api/me', { headers: accessHeaders(token) })).status).toBe(401);
  });

  it('rejects an unsigned "alg: none" token', async () => {
    const token = await mintToken({ email: 'roland@example.com', alg: 'none' });
    expect((await call('/api/me', { headers: accessHeaders(token) })).status).toBe(401);
  });

  it('rejects a token whose key id is unknown', async () => {
    const token = await mintToken({ email: 'roland@example.com', kid: 'not-a-real-kid' });
    expect((await call('/api/me', { headers: accessHeaders(token) })).status).toBe(401);
  });

  it('rejects a malformed token', async () => {
    for (const bogus of ['', 'not.a.jwt', 'aaa', 'a.b']) {
      const res = await call('/api/me', { headers: { 'Cf-Access-Jwt-Assertion': bogus } });
      expect(res.status, bogus).toBe(401);
    }
  });

  it('attributes annotations to the authenticated user', async () => {
    const token = await mintToken({ email: 'roland@example.com' });
    const headers = { ...accessHeaders(token), 'content-type': 'application/json' };

    const col = await api('/api/collections', {
      ...postJson({ name: 'Auth', description: null }),
      headers,
    });
    const form = new FormData();
    form.append('file', new File([pngBytes()], 's.png', { type: 'image/png' }));
    const shot = await api(`/api/collections/${col.body.id}/screenshots`, {
      method: 'POST',
      body: form,
      headers: accessHeaders(token),
    });

    const anno = await api(`/api/screenshots/${shot.body.id}/annotations`, {
      ...postJson({ body: 'mine' }),
      headers,
    });
    expect(anno.body.annotation.author).toBe('roland@example.com');
  });

  it('refuses a state-changing request from a foreign Origin', async () => {
    // CSRF backstop: a browser attaches the attacker page's Origin to a
    // cross-site request; the cookie-authenticated session must not honour it.
    const token = await mintToken({ email: 'roland@example.com' });
    const res = await api('/api/collections', {
      ...postJson({ name: 'csrf', description: null }),
      headers: {
        cookie: `CF_Authorization=${token}`,
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
    });
    expect(res.status).toBe(403);
  });

  it('accepts a state-changing request from its own Origin', async () => {
    const token = await mintToken({ email: 'roland@example.com' });
    const res = await api('/api/collections', {
      ...postJson({ name: 'same origin', description: null }),
      headers: {
        cookie: `CF_Authorization=${token}`,
        origin: 'https://shots.example.com',
        'content-type': 'application/json',
      },
    });
    expect(res.status).toBe(201);
  });

  it('leaves cross-origin reads alone — SameSite and Access gate those', async () => {
    const token = await mintToken({ email: 'roland@example.com' });
    const res = await call('/api/me', {
      headers: { cookie: `CF_Authorization=${token}`, origin: 'https://evil.example' },
    });
    expect(res.status).toBe(200);
  });

  it('leaves public share routes reachable with no assertion', async () => {
    // Set the share up as a signed-in user would, then put Access back.
    env.ACCESS_TEAM_DOMAIN = '';
    env.ACCESS_AUD = '';
    env.DEV_IDENTITY = 'tester@example.com';
    const col = await createCollection();
    const { body: link } = await api(`/api/collections/${col.id}/share`, { method: 'POST' });

    // The /p/* bypass policy means these requests never carry an assertion.
    await behindAccess();
    expect((await call('/api/collections')).status).toBe(401);
    expect((await api(`/p/${link.token}/data`)).status).toBe(200);
  });
});
