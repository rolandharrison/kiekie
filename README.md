# kiekie

Screenshot collection & annotation system for agent workflows.

Claude Code registers a screenshot through a **local MCP server**; you open the
returned URL on any device, draw on the image and leave comments; the agent reads
those comments — with their region coordinates — straight back.

```
┌─────────────── dev machine ───────────────┐
│  Claude Code ──(MCP over HTTP)──► MCP     │
│                               container   │
│         reads file from mounted   │       │
│         host path, uploads ───────┼─────► │
└───────────────────────────────────┼───────┘
                                    ▼
                  ┌──────── Cloudflare ─────────┐
                  │ Worker (Hono): API + Web UI │
                  │   ├── R2  (image blobs)     │
                  │   ├── D1  (metadata/annos)  │
                  │   └── Access (auth)         │
                  └─────────────────────────────┘
```

See [`plan.md`](./plan.md) for the original design and
[`IMPLEMENTATION.md`](./IMPLEMENTATION.md) for how it was built.

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

Locally there is no Cloudflare Access, so the Worker uses the `DEV_IDENTITY` var
(`dev@localhost`) as the caller. `TRUST_ACCESS_HEADERS` is off, which means Access
headers are deliberately *ignored* — nobody can forge an identity by setting a
header against a dev instance.

## Deploying

1. Create the resources and wire the ids into `worker/wrangler.toml`:
   ```bash
   npx wrangler d1 create kiekie              # paste database_id into wrangler.toml
   npx wrangler r2 bucket create kiekie-screenshots
   npm run migrate:remote --workspace worker
   ```
2. Turn on header trust for production (this is what makes Access authoritative):
   ```toml
   [vars]
   TRUST_ACCESS_HEADERS = "1"
   DEV_IDENTITY = ""
   ```
3. `npm run build --workspace web && npm run deploy --workspace worker`
4. Put Cloudflare Access in front of the hostname:
   - an **Allow** policy for your own email(s) — covers the browser;
   - a **service token**, added to the same policy — covers the MCP servers;
   - a **Bypass** policy scoped to the `/p/*` path so public share links skip the
     login wall. Everything else on the hostname stays gated, and the Worker
     validates the share token itself.

The bucket stays private: images are only reachable via `GET /img/:key` (behind
Access) or `GET /p/:token/img/:key` (scoped to what that link actually shares).

## Running the MCP server

```bash
cd mcp
API_BASE=https://shots.yourdomain.com \
WEB_BASE=https://shots.yourdomain.com \
CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... \
PATH_MAP='C:\Dev=/host/dev' HOST_WORK_DIR='C:\Dev' \
docker compose up -d --build
```

Then, once per machine:

```bash
claude mcp add --transport http screenshots http://localhost:8899/mcp
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
npm test            # 76 Worker tests (real D1 + R2 in Miniflare) + 30 MCP tests
npm run test:e2e    # 20 Playwright specs against a real local Worker
```

The e2e run builds the SPA, builds the MCP server, applies migrations to an
isolated `worker/.e2e-state` store and boots `wrangler dev` on port 8788 — no
manual setup. `e2e/mcp.spec.ts` spawns the actual MCP binary and drives the whole
loop: agent uploads → human annotates in the browser → agent reads the comment back.
