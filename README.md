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

## Using it with a coding agent

The point of kiekie is a tight visual-review loop: the agent changes some UI,
captures screenshots, registers them, you scribble on the images and leave
comments, and the agent reads that feedback straight back and acts on it. Here
is how to wire that into day-to-day work with Claude Code.

### 1. Tell the agent about it (CLAUDE.md)

Drop a block like this into the `CLAUDE.md` of the project you are working on
(not this repo - the app you are building). It teaches the agent when and how to
use the kiekie tools:

```markdown
## Visual review with kiekie

When you finish a user-facing UI change, put it up for review before calling it done:

1. Run the app locally (`npm run dev`) and capture the affected screens with the
   Playwright CLI at desktop and mobile widths, into `.kiekie/` in this repo
   (that folder is under the host directory mounted into the MCP container, so
   the MCP can read the files - anywhere outside it is rejected).
2. Create one collection per branch/PR with `create_collection`. Name it after
   the branch and write a `description` summarising the change so I (and other
   agents) can tell collections apart.
3. Add every screenshot with `add_screenshot`, giving each a `description` of
   what it shows and which viewport (e.g. "Pricing page, 390x844 mobile").
4. Reply with the collection URL and stop. Do not assume the change is approved.
5. When I say I have reviewed, call `get_collection_annotations`, apply every
   open comment, then re-capture and add the updated screenshots to the same
   collection so the before/after lives together.

Prefer the region a comment points at (normalised x/y/w/h) to locate what I mean.
```

### 2. Capture screenshots (Playwright CLI)

The [Playwright CLI](https://github.com/microsoft/playwright-cli)
(`@playwright/cli`) is a stateful, agent-oriented browser driver - distinct from
the `npx playwright` test runner. You `open` a page into a named session, then
drive it and capture with terse commands whose output is easy for an agent to
consume; the browser (cookies, storage, current page) persists between calls.

```bash
npm install -g @playwright/cli@latest

# Desktop: open the page in the default session, then screenshot it
playwright-cli open http://localhost:3000/pricing
playwright-cli screenshot --filename=.kiekie/pricing-desktop.png

# Mobile: a separate named session emulating a device
playwright-cli -s=mobile open --device="iPhone 15" http://localhost:3000/pricing
playwright-cli -s=mobile screenshot --filename=.kiekie/pricing-mobile.png

# Interact, then capture the result. `snapshot` prints the page as YAML with
# element refs (e5, e12, ...) that click/fill/type take.
playwright-cli snapshot
playwright-cli click e12                 # the annual-billing toggle
playwright-cli screenshot --filename=.kiekie/pricing-annual.png

playwright-cli close-all                  # tear the sessions down when done
```

Save the files under the folder mounted into the MCP container (`.kiekie/` in a
repo under your mounted root), so `add_screenshot` can read them. If the global
`playwright-cli` command is not on PATH, invoke it as `npx playwright cli ...`.

### 3. The review loop

A single cycle, showing who does what:

```
agent  create_collection("feat/pricing-tiers", "New 3-tier pricing card + annual toggle")
         -> { collection_id: "ab12cd", url: "https://<your-host>/c/ab12cd" }
agent  add_screenshot("ab12cd", ".kiekie/pricing-desktop.png", description: "Pricing, 1280 desktop")
agent  add_screenshot("ab12cd", ".kiekie/pricing-mobile.png",  description: "Pricing, 390x844 mobile")
agent  "Ready for review: https://<your-host>/c/ab12cd"

you    open the URL, turn on Annotate, drop a pin on the annual toggle:
       "make this the default", and a region on the card: "price is cut off at 390px"

agent  get_collection_annotations("ab12cd")
         -> [ { body: "make this the default", x: 0.62, y: 0.31, ... },
              { body: "price is cut off at 390px", x: 0.1, y: 0.4, w: 0.3, h: 0.08, ... } ]
agent  applies both, re-captures, add_screenshot(...) the updated shots
```

You review while signed in through Access. To get feedback from someone who is
**not** on your Access allow-list (a client, a designer), open the collection or
a single screenshot and hit **Share** in the viewer - that mints a read-only
`/p/{token}` link that works with no login, which you paste to them. Their
comments come back through `get_collection_annotations` just the same, and you
can revoke the link (or let it expire) when the review is over.

## Tests

```bash
npm run typecheck   # all three workspaces
npm test            # Worker tests (real D1 + R2 in Miniflare) + MCP tests
npm run test:e2e    # Playwright specs against a real local Worker
```

The e2e suite needs no manual setup and covers the full loop: agent uploads
over MCP, a human annotates in the browser, the agent reads the comment back.
