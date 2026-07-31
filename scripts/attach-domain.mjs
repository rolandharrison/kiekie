#!/usr/bin/env node
/**
 * Idempotently binds kiekie.example to the deployed Worker.
 *
 * Kept out of `wrangler.toml` on purpose: wrangler reconciles routes through the
 * zone-scoped Workers Routes API, which would require the deploy token to carry
 * zone-edit rights on every CI run. Attaching a custom domain is a one-time
 * setup step, so it lives here and runs by hand.
 *
 * Usage: node scripts/attach-domain.mjs [hostname]
 * Reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from the environment.
 */
import process from 'node:process';

const HOSTNAME = process.argv[2] ?? 'kiekie.example';
const SERVICE = 'kiekie';
const ENVIRONMENT = 'production';

const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

if (!token || !accountId) {
  console.error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set (see .env.local).');
  process.exit(1);
}

const api = async (path, init = {}) => {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json();
  if (!body.success) {
    const detail = (body.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ');
    throw new Error(`${path} failed — ${detail || res.status}`);
  }
  return body.result;
};

const zoneName = HOSTNAME.split('.').slice(-2).join('.');
const zones = await api(`/zones?name=${encodeURIComponent(zoneName)}&account.id=${accountId}`);
if (!zones.length) throw new Error(`no zone named ${zoneName} in this account`);
const zoneId = zones[0].id;

const existing = await api(`/accounts/${accountId}/workers/domains`);
const already = existing.find((d) => d.hostname === HOSTNAME && d.service === SERVICE);
if (already) {
  console.log(`${HOSTNAME} is already bound to ${SERVICE} (${already.environment}).`);
  process.exit(0);
}

const record = await api(`/accounts/${accountId}/workers/domains`, {
  method: 'PUT',
  body: JSON.stringify({
    environment: ENVIRONMENT,
    hostname: HOSTNAME,
    service: SERVICE,
    zone_id: zoneId,
  }),
});
console.log(`bound ${record.hostname} -> ${record.service} (${record.environment})`);
