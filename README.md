# kiekie

Screenshot collection & annotation system for agent workflows.

Claude Code registers a screenshot through a **local MCP server**; you open the
returned URL on any device, draw on the image and leave comments; the agent reads
those comments — with their region coordinates — straight back.

```
+--------------- dev machine ---------------+
|  Claude Code --(MCP over HTTP)--> MCP     |
|                               container   |
|                                   |       |
|         reads file from mounted   |       |
|         host path, uploads -------+       |
+-----------------------------------|-------+
                                    |
                                    v
                     +-------- Cloudflare ---------+
                     | Worker (Hono): API + Web UI |
                     |   +-- R2  (image blobs)     |
                     |   +-- D1  (metadata/annos)  |
                     |   +-- Access (auth)         |
                     +-----------------------------+
```

Setting this up on a new machine? See [`INSTALL.md`](./INSTALL.md).
See [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) for how it was built.

## Layout

| Path | What |
|---|---|
| `worker/` | Cloudflare Worker — JSON API, R2 image streaming, public share routes, static asset host |
| `web/` | Preact + Vite SPA, built into `worker/public` so there is one deployable |
| `mcp/` | Local MCP server (Node + Docker) that Claude Code connects to |
| `e2e/` | Playwright specs driving the real browser against a local Worker |

## Quick start (local)

```bash
npm install
npm run build --workspace web        # SPA -> worker/public
npm run migrate:local                # apply D1 schema to the local simulator
npm run dev                          # wrangler dev on http://localhost:8787
```

Locally there is no Cloudflare Access, so the Worker falls back to the
`DEV_IDENTITY` var (`dev@localhost`) as the caller. The `ACCESS_*` vars are unset
in the top-level `[vars]`, so a dev instance never tries to verify tokens — and
because production sets `DEV_IDENTITY = ""`, the reverse can't happen either: if
the Access config were ever removed from the deployed Worker it would 401
everything rather than silently fall open.

## How authentication works

Cloudflare Access authenticates at the edge and forwards a **signed JWT** in the
`Cf-Access-Jwt-Assertion` header (and the `CF_Authorization` cookie). The Worker
verifies that signature against the tenant's published keys before trusting
anything — see `worker/src/access.ts`. It checks the signature, the `aud` (so a
token minted for a *different* Access app on the same tenant is rejected), the
issuer, and expiry.

Two claim shapes map to two caller kinds:

| Claim | Caller | Identity |
|---|---|---|
| `email` | human who logged in | that email |
| `common_name` | Access service token | `service:<client-id>` |

Note that Access **consumes** the `CF-Access-Client-Id`/`Secret` headers a service
token client sends — they never reach the Worker. Reading those raw headers
therefore doesn't work for machine callers at all, and reading
`Cf-Access-Authenticated-User-Email` would be forgeable the moment the Worker
were reachable on any hostname Access doesn't cover. The JWT is the only real
boundary, so it's the only thing trusted.

One consequence worth stating plainly: there is **no per-user authorization
inside the app**. Every identity Access admits — human or service token — has
full read/write over all collections, screenshots, annotations and share
links. The Access policy *is* the permission model, so only add people and
tokens you'd trust with everything.

## Live deployment

Runs on a custom domain behind Cloudflare Access, deployed automatically by
GitHub Actions on every push to `main` (`.github/workflows/deploy.yml`):
typecheck → unit tests → Playwright e2e → build → D1 migrations → deploy →
authenticated smoke test. The production hostname is deliberately not in the
repo: the Worker reads `WEB_BASE`, `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` from
Worker secrets, and CI reads `APP_ORIGIN`/`WORKERS_DEV_ORIGIN` from repo
secrets.

Cloudflare setup, as provisioned (`<domain>` = your production hostname):

- **Access app `kiekie`** on `<domain>` — Allow policy for the owner's email
  (one-time PIN), plus a non-identity policy for the `kiekie-mcp` service token.
- **Access app `kiekie public share links`** on `<domain>/p` — a Bypass policy,
  so `/p/*` skips the login wall. It's a more specific path, so it wins over the
  gated app. Everything else on the hostname stays behind Access, and the Worker
  validates the share token itself.
- **Access app `kiekie static assets`** on `<domain>/assets` — a Bypass policy.
  This is **required**, not optional: the public share page's HTML is bypassed
  under `/p`, but it loads its JS/CSS from `/assets/*`. If those stay gated, an
  anonymous visitor gets the shell but the bundle 302s to the login and the page
  renders blank. The compiled SPA bundle carries no secrets — all data access is
  still through the gated `/api` and `/img` — so exposing it is safe. The deploy
  smoke test asserts `/assets/*` is not behind Access.
- **`workers_dev = false`** — pinned off deliberately. A `workers.dev` URL would
  serve the same app on a hostname Access cannot protect, bypassing the login
  wall entirely. The deploy smoke test asserts it stays disabled.
- The custom domain is bound once via `npm run attach:domain`, not on every
  deploy — see `scripts/attach-domain.mjs` for why.

To set this up from scratch on another account:

```bash
cp .env.example .env.local          # fill in CLOUDFLARE_API_TOKEN
npx wrangler d1 create kiekie       # paste database_id into worker/wrangler.toml
npx wrangler r2 bucket create kiekie-screenshots
npm run attach:domain your-host.example
# Access apps to create (Zero Trust > Access > Applications):
#   1. gated app on the whole host   -> Allow (your email) + service token
#   2. bypass app on <host>/p        -> Bypass everyone   (public share links)
#   3. bypass app on <host>/assets   -> Bypass everyone   (SPA bundle; else blank)
# then put the team domain and the gated app's AUD tag into
# [env.production.vars] in worker/wrangler.toml
npm run deploy
```

The bucket stays private: images are only reachable via `GET /img/:key` (behind
Access) or `GET /p/:token/img/:key` (scoped to what that link actually shares).

## Running the MCP server

```bash
cp mcp/.env.example mcp/.env    # fill in the Access service token
docker compose -f mcp/docker-compose.yml up -d --build
curl http://127.0.0.1:8899/health
```

`mcp/.env` holds only the Access service token and the path mapping —
deliberately not the Cloudflare API token, which the container has no business
being able to read.

Then, once per machine:

```bash
claude mcp add --transport http --scope user kiekie http://127.0.0.1:8899/mcp
```

`PATH_MAP` translates host paths (what Claude Code knows) into container paths
(where the file is actually readable), and the matching `volumes:` entry is what
makes it readable at all — the two must agree. A path outside the mounted roots
returns an error naming those roots, so the agent knows where to save screenshots.
The port is published on `127.0.0.1` only, so the MCP itself needs no auth.

### Tools

| Tool | Args | Returns |
|---|---|---|
| `create_collection` | `name`, `description?` | `{collection_id, url}` |
| `update_collection` | `collection_id`, `name?`, `description?` | ok |
| `list_collections` | — | most recently updated first, with descriptions and counts |
| `add_screenshot` | `collection_id`, `file_path`, `filename?` | `{screenshot_id, url, width, height}` |
| `list_screenshots` | `collection_id` | `[{id, filename, url, annotation_count}]` |
| `get_annotations` | `screenshot_id` | comments incl. region coords, author, resolved |
| `get_collection_annotations` | `collection_id` | every comment in the collection |

Region coordinates are normalised 0–1. A zero-size region is a pin; all-null
coordinates mean the comment is about the whole image.

## Web UI

- Dark by default, light when the OS asks, and either can be pinned with the
  top-bar toggle (stored in `localStorage`, re-applied by an inline script in
  `index.html` so there is no flash on load). One hand-written stylesheet,
  `web/src/styles.css` — tokens rather than a utility framework, because the
  public share page has to boot fast on a phone. The logo and icons are inline
  SVG (`components/Logo.tsx`, `components/icons.tsx`) and the favicon is a data
  URI, since anything under a separate path would sit outside the `/assets`
  Access bypass and 302 to the login on share pages.
- Layout is fluid from ~360px up: the viewer's comment rail sits beside the
  image on desktop and stacks below it on a phone, and the share-links table
  becomes labelled cards under 720px. The top bar is one non-wrapping line —
  the identity chip is the only element allowed to shrink, and it drops to a
  monogram (with the address in its tooltip) rather than pushing the bar wide.
- Creating a collection, uploading a screenshot and minting a share link are
  each a prominent button that opens a modal. The modals are the native
  `<dialog>` element via `showModal()`, so the focus trap, inert background and
  Escape-to-close come from the browser rather than from hand-written a11y code.
  Notably, the share expiry is asked for *inside* the dialog: opening it mints
  nothing, so an idle click can never leak a public URL.
- Collections ordered by most recent activity, each with its description and count.
- Inside a collection, screenshots bucket into **Today · Last 3 days · Last week ·
  Last month · Older**, computed in the viewer's own timezone.
- Click an image to drop a pin, drag to mark a region, or comment on the whole
  image. Comments show the author (from the Access email) and can be edited,
  resolved and deleted.
- Share any collection or screenshot as a revocable read-only `/p/{token}` link,
  optionally with an expiry (never / 1 / 7 / 30 days). `/shares` lists them with
  their deadline; expired links stay listed but flagged, and stop working
  immediately — page, JSON and image alike.

## Tests

```bash
npm run typecheck   # all three workspaces
npm test            # 85 Worker tests (real D1 + R2 in Miniflare) + 30 MCP tests
npm run test:e2e    # 22 Playwright specs against a real local Worker
```

The e2e run builds the SPA, builds the MCP server, applies migrations to an
isolated `worker/.e2e-state` store and boots `wrangler dev` on port 8788 — no
manual setup. `e2e/mcp.spec.ts` spawns the actual MCP binary and drives the whole
loop: agent uploads → human annotates in the browser → agent reads the comment back.
