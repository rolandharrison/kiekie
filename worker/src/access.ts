/**
 * Cloudflare Access JWT verification.
 *
 * Access authenticates the caller at the edge and forwards a signed assertion in
 * the `Cf-Access-Jwt-Assertion` header (also set as the `CF_Authorization`
 * cookie). That signature is the real trust boundary: Access *consumes* the
 * `CF-Access-Client-Id`/`Secret` headers a service token client sends rather than
 * passing them through, so reading raw headers both fails for service tokens and
 * would be forgeable the moment the Worker were reachable off its Access hostname.
 *
 * Claims we care about:
 *   email        — set for a human who logged in through an IdP
 *   common_name  — set instead for a service token; equals its client id
 */
export interface AccessClaims {
  aud?: string[] | string;
  iss?: string;
  exp?: number;
  nbf?: number;
  email?: string;
  common_name?: string;
  sub?: string;
}

export interface VerifyOptions {
  teamDomain: string;
  aud: string;
  /** Tolerance for clock drift between Cloudflare and the Worker, in seconds. */
  skewSeconds?: number;
  now?: () => number;
}

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

interface CacheEntry {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}

const JWKS_TTL_MS = 60 * 60 * 1000;
const jwksCache = new Map<string, CacheEntry>();

/** Tests need a clean slate between cases. */
export function resetJwksCache() {
  jwksCache.clear();
}

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function decodeJson(segment: string): any {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

async function loadKeys(teamDomain: string, now: number): Promise<Map<string, CryptoKey>> {
  const cached = jwksCache.get(teamDomain);
  if (cached && now - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;

  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`could not fetch Access signing keys (${res.status})`);
  const body = (await res.json()) as { keys?: Jwk[] };

  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys ?? []) {
    if (jwk.kty !== 'RSA' || !jwk.kid) continue;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    keys.set(jwk.kid, key);
  }

  jwksCache.set(teamDomain, { keys, fetchedAt: now });
  return keys;
}

export type VerifyResult =
  | { ok: true; claims: AccessClaims }
  | { ok: false; reason: string };

export async function verifyAccessJwt(
  token: string,
  options: VerifyOptions,
): Promise<VerifyResult> {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed token' };

  let header: { alg?: string; kid?: string };
  let claims: AccessClaims;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson(parts[1]);
  } catch {
    return { ok: false, reason: 'undecodable token' };
  }

  // Pinning the algorithm closes the "alg: none" and HMAC-confusion families.
  if (header.alg !== 'RS256') return { ok: false, reason: 'unexpected signing algorithm' };
  if (!header.kid) return { ok: false, reason: 'token has no key id' };

  const nowSeconds = Math.floor((options.now?.() ?? Date.now()) / 1000);
  const skew = options.skewSeconds ?? 60;

  let keys: Map<string, CryptoKey>;
  try {
    keys = await loadKeys(options.teamDomain, options.now?.() ?? Date.now());
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }

  const key = keys.get(header.kid);
  if (!key) return { ok: false, reason: 'unknown signing key' };

  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!verified) return { ok: false, reason: 'bad signature' };

  // A valid signature from the right team still isn't enough: the token must
  // have been minted for *this* application, or any other app on the same Access
  // tenant would be a valid credential here.
  const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!audiences.includes(options.aud)) return { ok: false, reason: 'token is for another application' };

  if (claims.iss !== `https://${options.teamDomain}`) return { ok: false, reason: 'wrong issuer' };
  if (typeof claims.exp === 'number' && claims.exp + skew < nowSeconds) {
    return { ok: false, reason: 'token expired' };
  }
  if (typeof claims.nbf === 'number' && claims.nbf - skew > nowSeconds) {
    return { ok: false, reason: 'token not yet valid' };
  }

  return { ok: true, claims };
}
