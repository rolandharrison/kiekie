# kiekie — Implementation Plan

Derived from [`plan.md`](./plan.md). This document is the build-order contract: what
gets written, where it lives, how it is wired, and how each piece is proven to work.

---

## 0. Repository layout

npm workspaces monorepo, TypeScript end to end.

```
kiekie/
├── package.json                 # workspaces root; scripts: dev, build, test, test:e2e
├── plan.md                      # original design (unchanged)
├── IMPLEMENTATION.md            # this file
├── README.md                    # setup / deploy / usage
├── worker/                      # Cloudflare Worker — API + static asset host
│   ├── wrangler.toml            # D1 + R2 + assets bindings
│   ├── migrations/0001_init.sql # D1 schema
│   ├── src/
│   │   ├── index.ts             # Hono app composition + asset/SPA fallback
│   │   ├── env.ts               # Env type, bindings
│   │   ├── auth.ts              # Access identity middleware (browser + service token)
│   │   ├── ids.ts               # nanoid-style id generation
│   │   ├── images.ts            # PNG/JPEG/WebP/GIF dimension sniffing (no deps)
│   │   ├── db.ts                # typed D1 helpers
│   │   └── routes/
│   │       ├── collections.ts
│   │       ├── screenshots.ts
│   │       ├── annotations.ts
│   │       ├── share.ts         # /api/.../share, /api/share-links
│   │       ├── img.ts           # GET /img/:key (auth'd R2 stream)
│   │       └── public.ts        # GET /p/:token, /p/:token/data, /p/:token/img/:key
│   └── test/                    # vitest + @cloudflare/vitest-pool-workers
├── web/                         # Preact + Vite SPA -> built into worker/public
│   └── src/{main.tsx, api.ts, router.ts, buckets.ts, pages/, components/}
├── mcp/                         # local MCP server (Docker, one per machine)
│   ├── src/{index.ts, server.ts, pathmap.ts, client.ts}
│   ├── test/                    # vitest
│   ├── Dockerfile
│   └── docker-compose.yml
└── e2e/                         # Playwright specs + fixtures
```

**Why one Worker for API + UI:** single deployable, same origin, so Access covers
both and the SPA needs no CORS or token juggling.

---

## 1. Data layer (D1)

`worker/migrations/0001_init.sql` implements the four tables from `plan.md`
verbatim — `collections`, `screenshots`, `annotations`, `share_links` — plus:

- `PRAGMA foreign_keys` friendly `ON DELETE CASCADE` on `screenshots.collection_id`
  and `annotations.screenshot_id` so deletes are one statement.
- Indices: `screenshots(collection_id, created_at DESC)`,
  `annotations(screenshot_id)`, `share_links(kind, target_id)`,
  `collections(updated_at DESC)`.

`collections.updated_at` is bumped explicitly on: screenshot add, screenshot
delete, annotation create, collection patch. That drives the recency ordering the
UI and `list_collections` depend on.

R2 keys are `{collection_id}/{screenshot_id}.{ext}` — derivable, and prefix-listable
per collection for cleanup.

---

## 2. Auth model

One middleware, three caller classes (matching the `plan.md` table):

| Caller | Detection | Identity |
|---|---|---|
| Browser behind Access | `email` claim in the Access JWT | that email |
| MCP / machine | `common_name` claim in the Access JWT | `service:{clientId}` |
| Public share visitor | request path under `/p/*` | none; read-only |

`plan.md` proposed trusting the `Cf-Access-Authenticated-User-Email` and
`CF-Access-Client-*` headers directly. **That does not work, and was replaced by
JWT verification** (`worker/src/access.ts`) after testing against the real
deployment:

- Access *consumes* the `CF-Access-Client-Id`/`Secret` headers when it validates a
  service token — they never reach the Worker — so header-reading fails outright
  for every machine caller.
- A plain header is only as trustworthy as the guarantee that every request
  passed through Access, and that's a deployment property the Worker cannot check.

So the Worker verifies the signed `Cf-Access-Jwt-Assertion` (or `CF_Authorization`
cookie) against the tenant's JWKS: RS256 pinned (closing the `alg: none` and
HMAC-confusion families), signature checked, `aud` matched to this specific
application so a token for another app on the same tenant is rejected, issuer
matched, `exp`/`nbf` honoured with a small skew. Keys are cached in module scope
for an hour.

`ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` being set is what puts the Worker in
production mode. Locally they're unset and `DEV_IDENTITY` supplies a stub caller,
so the whole app is exercisable without a Zero Trust tenant. Production sets
`DEV_IDENTITY = ""`, so that fallback cannot fire there — the deployment fails
closed. Any `/api/*` request with no resolvable identity gets `401`.

`/p/*` is served by a separate router mounted **before** the auth middleware and
has no write verbs at all — public read-only is enforced by routing, not by UI
hiding. Share-token scoping is checked server-side: `/p/:token/img/:key` verifies
the key's collection belongs to the shared target.

---

## 3. Worker API

Exactly the surface in `plan.md` §"API surface", implemented with Hono:

```
POST   /api/collections                      {name, description}
GET    /api/collections                      updated_at DESC, with screenshot counts
GET    /api/collections/:cid                 collection + screenshots (+ annotation counts)
PATCH  /api/collections/:cid                 {name?, description?}
DELETE /api/collections/:cid                 cascades D1 rows + deletes R2 objects
POST   /api/collections/:cid/screenshots     multipart file -> R2 + row; bumps updated_at
GET    /api/collections/:cid/annotations     all annotations across the collection
GET    /api/screenshots/:sid                 metadata + annotations
DELETE /api/screenshots/:sid
PATCH  /api/screenshots/:sid                 {collection_id} — move between collections
GET    /api/screenshots/:sid/annotations
POST   /api/screenshots/:sid/annotations     {body, x?, y?, w?, h?}; author = identity
PATCH  /api/annotations/:aid                 {body?, resolved?}
DELETE /api/annotations/:aid
POST   /api/collections/:cid/share           {expires_in_days?} -> {url, expires_at}
POST   /api/screenshots/:sid/share           {expires_in_days?} -> {url, expires_at}
GET    /api/share-links                      unrevoked links w/ target names + expired flag
DELETE /api/share-links/:token               revoke
GET    /img/:key                             auth'd R2 stream, immutable cache
GET    /p/:token                             public viewer (SPA shell)
GET    /p/:token/data                        public JSON
GET    /p/:token/img/:key                    public image bytes, scope-checked
```

Cross-cutting: JSON error envelope `{error: string}`, 404 on unknown ids, 400 on
validation failure (name required, annotation body required, region coords must be
0–1 when present), width/height sniffed from the upload bytes at insert time so the
viewer can overlay regions accurately.

---

## 4. Web UI (Preact SPA)

Routes: `/` (collections), `/c/:cid`, `/c/:cid/s/:sid`, `/shares`, `/p/:token`,
`/p/:token/s/:sid`.

- **Collection list** — recency ordered, description under each name, screenshot
  count, new-collection form, rename/edit/delete, share button.
- **Collection view** — screenshots bucketed client-side into
  *Today · Last 3 days · Last week · Last month · Older* from `created_at`
  (viewer-local timezone), grid of thumbnails with annotation-count badges.
- **Screenshot viewer** — image with SVG overlay of existing pins/rects. Click drops
  a pin; click-drag draws a rect; both open a comment composer. A separate
  whole-image comment box. Comment list with resolve / edit / delete, author and
  timestamp. Move-to-collection selector. Share button.
- **Shares page** — active links, target, creator, copy + revoke.
- **Public viewer** — same components, `readOnly` flag, fed by `/p/:token/data`;
  no composer rendered and no write endpoints reachable.

Everything gets stable `data-testid` attributes so Playwright drives real user
flows rather than internals.

---

## 5. MCP server

Node 22, `@modelcontextprotocol/sdk`, Streamable HTTP on `0.0.0.0:8899` inside the
container (published to `127.0.0.1:8899` only).

Tools, exactly as specified: `create_collection`, `update_collection`,
`list_collections`, `add_screenshot`, `list_screenshots`, `get_annotations`,
`get_collection_annotations`.

**Path mapping** (`pathmap.ts`) is the subtle part and gets its own unit tests:
- normalise `\` → `/`, collapse duplicate separators, uppercase drive letter
- match against `PATH_MAP` entries (`hostPrefix=containerPrefix`, `;`-separated),
  longest prefix wins, case-insensitive on Windows-style prefixes
- reject `..` traversal after mapping
- unmapped path → error message that *names the mounted roots*, so the agent knows
  where to save screenshots

`client.ts` wraps the Worker API with `CF-Access-Client-Id/Secret` headers and
surfaces the `WEB_BASE` URLs (`/c/{cid}`, `/c/{cid}/s/{sid}`) back to Claude Code.

Dockerfile: multi-stage, `node:22-alpine`, non-root, healthcheck on `/health`.
`docker-compose.yml` per `plan.md` with `restart: unless-stopped`, read-only mount,
and a single merged `environment:` block (the original had two, the second of which
would silently drop the API/token vars — fixed here).

---

## 6. Test strategy — "fully tested"

Three layers, all runnable from `npm test` / `npm run test:e2e`:

1. **Worker integration tests** (`@cloudflare/vitest-pool-workers`) — run against
   real D1 + R2 in Miniflare. Cover: every endpoint's happy path; auth 401s;
   validation 400s; cascade deletes remove R2 objects; `updated_at` bumping and
   ordering; share-token scoping (a token for collection A cannot read collection
   B's image); revoked token → 404; expired token → 404 on page, data and image,
   with expiry distinguished from revocation; public routes reject POST/PATCH/DELETE.
   Auth is tested against **real RS256 assertions** minted in-test from a generated
   keypair, with the tenant JWKS stubbed via `fetchMock` — covering tampered
   signatures, foreign keys, wrong `aud`, wrong issuer, expired, not-yet-valid,
   `alg: none`, unknown `kid`, and the legacy plaintext headers being ignored.
2. **MCP unit tests** (vitest) — path mapping table (Windows, POSIX, longest-prefix,
   traversal, unmapped-error text), each tool's request shaping against a stubbed
   fetch, and error propagation.
3. **Playwright e2e** (`e2e/`) — boots `wrangler dev` with local D1/R2 and a dev
   identity, then drives the browser:
   - create collection → appears in list with description
   - upload a screenshot (real PNG fixture) → appears in the *Today* bucket
   - open viewer → drop a pin comment and a rectangle comment → both render and
     persist across reload
   - resolve / edit / delete a comment
   - move a screenshot between collections
   - create a share link → open in a fresh incognito context → images and
     annotations visible, no comment composer present
   - revoke the link → public page 404s

CI-shaped scripts: `npm run typecheck`, `npm test`, `npm run test:e2e`.

---

## 7. Build order

1. Scaffold workspaces, wrangler config, D1 migration.
2. Worker: env/auth/ids/db → collections → screenshots+img → annotations → share/public.
3. Worker vitest suite (written alongside each route group).
4. Web SPA against the live local API.
5. Playwright e2e over the SPA.
6. MCP server + pathmap tests + Docker.
7. README (deploy steps, Access config, MCP registration), commit, push.

## 8. Share-link expiry (migration `0002`)

`share_links.expires_at` is nullable — NULL means "never", which is exactly what
every pre-existing row meant, so the migration needs no backfill.

- Both share endpoints accept `expires_in_days`, which is tri-state: absent leaves
  an existing link's deadline untouched, `null` clears it, a positive number
  (≤ 3650) sets one. That lets the same endpoint mint, extend and un-expire.
- Reuse only applies to links that are still *live*; an expired link is replaced
  by a fresh token rather than resurrected.
- `/p/*` refuses expired links everywhere — page, data and image — and reports
  "expired" separately from "not found or revoked", because only one of those is
  actionable for the person holding the URL.
- `/api/share-links` keeps expired links listed with an `expired` flag rather than
  hiding them; a link that silently vanished would read as a bug. They stay
  revocable so the list can be tidied.

## 9. Deployment

Live at `https://kiekie.example`. GitHub Actions (`.github/workflows/deploy.yml`) runs
typecheck → unit tests → Playwright e2e → build → D1 migrations → deploy →
authenticated smoke test on every push to `main`.

Access is three applications on the one hostname: a host-wide **gated** app
(owner email + MCP service token), plus two **bypass** apps on more-specific
paths that therefore win — `/p/*` for public share pages and `/assets/*` for the
SPA bundle. The `/assets` bypass is load-bearing: without it the share page's
HTML loads but its JS 302s to the login and the page renders blank. The bundle
holds no secrets (all data goes through the gated `/api` and `/img`), so serving
it publicly is safe.

Three guards worth calling out, all asserted by the post-deploy smoke test:

- **`workers_dev = false`.** A `workers.dev` URL would serve the same app on a
  hostname Access cannot protect — a complete bypass of the login wall. It is
  pinned off rather than left to wrangler's default.
- **`/api/*` must not answer anonymously.** The smoke test fails the deploy if an
  unauthenticated request to `/api/collections` ever returns 200.
- **`/assets/*` must stay public.** The smoke test fails the deploy if a request
  for an asset redirects to the Access login — the regression that turns every
  public share link into a white page.

The custom domain is bound by `scripts/attach-domain.mjs` rather than declared in
`wrangler.toml`, because wrangler reconciles routes through the zone-scoped
Workers Routes API and that would force the CI token to carry zone-edit rights on
every run. Binding a domain is one-time setup, not a per-deploy concern.

## 10. Out of scope for v1 (per `plan.md` §5)

Thumbnail variants / Cloudflare Images and R2 lifecycle rules. The schema leaves
room for both without migration pain.
