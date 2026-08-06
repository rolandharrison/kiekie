# kiekie

Screenshot collection & annotation system for agent workflows.

Claude Code registers a screenshot through a **local MCP server**; you open the
returned URL on any device, draw on the image and leave comments; the agent reads
those comments - with their region coordinates - straight back.

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
Curious how it is built? See [`IMPLEMENTATION.md`](./IMPLEMENTATION.md).

## Features

- **Collections** of screenshots, ordered by most recent activity, with
  screenshots grouped by age (Today, Last 3 days, Last week, ...).
- **Annotate anywhere**: click to drop a pin, drag to mark a region, or comment
  on the whole image. Comments carry their author, can be edited, resolved and
  deleted, and their normalised coordinates flow back to the agent.
- **A real viewer**: zoom toward the cursor, pan around, download the original,
  and step through a collection with next/prev buttons or arrow keys.
- **Share links**: any collection or screenshot as a revocable read-only
  `/p/{token}` URL, optionally expiring (1 / 7 / 30 days / never). No login
  needed by the recipient; expired or revoked links stop working immediately.
- **Agent access over MCP**: create and list collections, register screenshots,
  and read annotations back - see the tools table below.
- **Locked down by default**: everything except share links sits behind
  Cloudflare Access (email one-time PIN for humans, service tokens for
  machines). The Access policy *is* the permission model - every identity it
  admits has full read/write, so only add people and tokens you trust.
- Works well on a phone, in dark or light theme.

## Layout

| Path | What |
|---|---|
| `worker/` | Cloudflare Worker - JSON API, image serving, share routes, static host |
| `web/` | The web UI, built into `worker/public` so there is one deployable |
| `mcp/` | Local MCP server (Node + Docker) that Claude Code connects to |
| `e2e/` | Playwright specs driving a real browser against a local Worker |

## Quick start (local)

```bash
npm install
npm run build --workspace web        # SPA -> worker/public
npm run migrate:local                # apply D1 schema to the local simulator
npm run dev                          # wrangler dev on http://localhost:8787
```

Locally there is no Cloudflare Access; the Worker uses the `DEV_IDENTITY` var
(`dev@localhost`) as the signed-in user, so the whole app works without any
Cloudflare account.

## Deploying

Deploys go out automatically from GitHub Actions on every push to `main`:
typecheck, unit tests and browser e2e first, then migrations, deploy and an
authenticated smoke test against the live site. The production hostname and
Access tenant are kept out of the repo (Worker and repo secrets).

To stand up your own instance on another Cloudflare account:

```bash
cp .env.example .env.local          # fill in the Cloudflare token + account
npx wrangler d1 create kiekie       # paste database_id into worker/wrangler.toml
npx wrangler r2 bucket create kiekie-screenshots
npm run attach:domain your-host.example
# In Zero Trust > Access > Applications, create:
#   1. a gated app on the whole host  -> Allow (your email) + service token
#   2. a bypass app on <host>/p       -> public share links
#   3. a bypass app on <host>/assets  -> the web bundle on share pages
# then set the WEB_BASE / ACCESS_TEAM_DOMAIN / ACCESS_AUD Worker secrets
npm run deploy
```

Images stay in a private bucket, reachable only through the authenticated
image route or a share link scoped to what that link actually shares.

## Running the MCP server

```bash
cp mcp/.env.example mcp/.env    # fill in the Access service token
docker compose -f mcp/docker-compose.yml up -d --build
curl http://127.0.0.1:8899/health
```

Then, once per machine:

```bash
claude mcp add --transport http --scope user kiekie http://127.0.0.1:8899/mcp
```

The container sees one host folder, read-only, and the port is published on
`127.0.0.1` only. [`INSTALL.md`](./INSTALL.md) walks through the details,
including creating the service token.

### Tools

| Tool | Args | Returns |
|---|---|---|
| `create_collection` | `name`, `description?` | `{collection_id, url}` |
| `update_collection` | `collection_id`, `name?`, `description?` | ok |
| `list_collections` | - | most recently updated first, with descriptions and counts |
| `add_screenshot` | `collection_id`, `file_path`, `filename?`, `description?` | `{screenshot_id, url, width, height}` |
| `list_screenshots` | `collection_id` | `[{id, filename, description, url, annotation_count}]` |
| `get_annotations` | `screenshot_id` | comments incl. region coords, author, resolved |
| `get_collection_annotations` | `collection_id` | every comment in the collection |

Region coordinates are normalised 0–1. A zero-size region is a pin; all-null
coordinates mean the comment is about the whole image.

## Tests

```bash
npm run typecheck   # all three workspaces
npm test            # Worker tests (real D1 + R2 in Miniflare) + MCP tests
npm run test:e2e    # Playwright specs against a real local Worker
```

The e2e suite needs no manual setup and covers the full loop: agent uploads
over MCP, a human annotates in the browser, the agent reads the comment back.
