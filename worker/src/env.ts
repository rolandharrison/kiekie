export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  /** Public origin used when minting share/collection URLs. */
  WEB_BASE?: string;
  /** e.g. "your-team.cloudflareaccess.com" — set only when behind Access. */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's AUD tag; scopes tokens to this app specifically. */
  ACCESS_AUD?: string;
  /** Local-only stub identity so the app works without a Zero Trust tenant. */
  DEV_IDENTITY?: string;
}

/** Identity of the caller, resolved by the auth middleware. */
export interface Identity {
  /** Email (browser) or `service:<client-id>` (MCP). */
  actor: string;
  kind: 'user' | 'service';
}

export type AppEnv = {
  Bindings: Env;
  Variables: { identity: Identity };
};

/** Base URL for links; falls back to the request origin when unset. */
export function webBase(env: Env, req: Request): string {
  const configured = env.WEB_BASE?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return new URL(req.url).origin;
}
