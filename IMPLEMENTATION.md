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
| Browser behind Access | `Cf-Access-Authenticated-User-Email` header | that email |
| MCP / machine | `CF-Access-Client-Id` + `CF-Access-Client-Secret` headers | `service:{clientId}` |
| Public share visitor | request path under `/p/*` | none; read-only |

Cloudflare Access validates *before* the request reaches the Worker, so the Worker
trusts these headers — but only when `TRUST_ACCESS_HEADERS` is on (production).
For local dev/test, `DEV_IDENTITY` env supplies a stub email so the whole app is
exercisable without a Zero Trust tenant. Any `/api/*` request with no resolvable
identity gets `401`.

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
POST   /api/collections/:cid/share           -> {url}
POST   /api/screenshots/:sid/share           -> {url}
GET    /api/share-links                      active links w/ target names
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
   B's image); revoked token → 404; public routes reject POST/PATCH/DELETE.
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

## 8. Out of scope for v1 (per `plan.md` §5)

Thumbnail variants / Cloudflare Images, share-link expiry dates, R2 lifecycle
rules. The schema leaves room for all three without migration pain.
