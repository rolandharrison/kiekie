import { fetchMock } from 'cloudflare:test';
import { resetJwksCache } from '../src/access';

export const TEAM_DOMAIN = 'test-tenant.cloudflareaccess.com';
export const AUD = 'aud-for-kiekie';
const KID = 'test-key-1';

let keyPair: CryptoKeyPair | null = null;

async function keys(): Promise<CryptoKeyPair> {
  if (!keyPair) {
    keyPair = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
  }
  return keyPair;
}

function b64url(bytes: Uint8Array | string): string {
  const raw =
    typeof bytes === 'string'
      ? bytes
      : Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface TokenOptions {
  email?: string;
  commonName?: string;
  aud?: string;
  iss?: string;
  exp?: number;
  nbf?: number;
  kid?: string;
  alg?: string;
  /** Corrupt the signature to simulate a forged token. */
  tamper?: boolean;
  /** Sign with a throwaway key that isn't in the published JWKS. */
  wrongKey?: boolean;
}

export async function mintToken(options: TokenOptions = {}): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: options.alg ?? 'RS256', kid: options.kid ?? KID, typ: 'JWT' };
  const payload: Record<string, unknown> = {
    aud: [options.aud ?? AUD],
    iss: options.iss ?? `https://${TEAM_DOMAIN}`,
    iat: nowSeconds,
    exp: options.exp ?? nowSeconds + 3600,
    nbf: options.nbf ?? nowSeconds - 10,
  };
  if (options.email) payload.email = options.email;
  if (options.commonName) payload.common_name = options.commonName;

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

  let privateKey = (await keys()).privateKey;
  if (options.wrongKey) {
    const other = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    privateKey = other.privateKey;
  }

  const signature = new Uint8Array(
    await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      privateKey,
      new TextEncoder().encode(signingInput),
    ),
  );
  if (options.tamper) signature[0] ^= 0xff;

  return `${signingInput}.${b64url(signature)}`;
}

/** Publish the test tenant's JWKS so the Worker can verify what we mint. */
export async function stubJwks() {
  resetJwksCache();
  const jwk = (await crypto.subtle.exportKey('jwk', (await keys()).publicKey)) as JsonWebKey;
  fetchMock.activate();
  fetchMock.disableNetConnect();
  fetchMock
    .get(`https://${TEAM_DOMAIN}`)
    .intercept({ path: '/cdn-cgi/access/certs' })
    .reply(200, JSON.stringify({ keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }] }), {
      headers: { 'content-type': 'application/json' },
    })
    .persist();
}

export function accessHeaders(token: string): Record<string, string> {
  return { 'Cf-Access-Jwt-Assertion': token };
}
