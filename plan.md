# Screenshot Collection & Annotation System — Design Plan

A two-part system: a **Cloudflare-hosted web app** for viewing/annotating/managing screenshots, and a **local MCP server** (Docker, one per machine) that Claude Code uses to register screenshots and read annotations back.

```
┌─────────────── dev machine ───────────────┐
│  Claude Code ──(MCP over HTTP)──► MCP     │
│  (happy.engineering)          container    │
│                                   │        │
│         reads file from mounted   │        │
│         host path, uploads ───────┼──────► │
└───────────────────────────────────┼────────┘
                                    ▼
                  ┌──────── Cloudflare ─────────┐
                  │ Worker (Hono): API + Web UI │
                  │   ├── R2  (image blobs)     │
                  │   ├── D1  (metadata/annos)  │
                  │   └── Access (auth)         │
                  └─────────────────────────────┘
```

---

## 1. Cloudflare side

### Stack
- **Worker** (Hono + TypeScript) — serves both the JSON API and the web UI (static assets via Workers Assets, or a small React/Preact SPA).
- **R2** — blob storage for images. Bucket is *private*; images are served through the Worker (`GET /img/:key`) so Access auth applies. No public bucket needed.
- **D1** — SQLite for collections, screenshots, annotations.
- **Cloudflare Access (Zero Trust)** — auth. Free tier covers up to 50 users.

### Auth (two paths, one app)
| Caller | Mechanism |
|---|---|
| You in a browser | Access policy on `shots.yourdomain.com` — email OTP or GitHub/Google login. Zero auth code in the app. |
| MCP server (machines) | Access **service token** — MCP sends `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers on API calls. One token shared across machines, or one per machine if you want revocation granularity. |
| Public share-link visitors | No login. Configure an Access **Bypass policy for the `/p/*` path** so those routes skip the login wall; the Worker validates the share token itself and serves everything read-only. Everything else on the hostname stays gated. |

The Worker can trust `Cf-Access-Authenticated-User-Email` / the service token JWT — Access has already validated everything before the request reaches you.

### Data model (D1)
```sql
CREATE TABLE collections (
  id TEXT PRIMARY KEY,          -- short id, nanoid(6) e.g. "kx3f9a"
  name TEXT NOT NULL,
  description TEXT,             -- purpose/context; agents read this to decide where a screenshot belongs
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))  -- bumped on any screenshot add/annotation; drives sort order
);

CREATE TABLE screenshots (
  id TEXT PRIMARY KEY,          -- nanoid(8)
  collection_id TEXT NOT NULL REFERENCES collections(id),
  r2_key TEXT NOT NULL,         -- e.g. "kx3f9a/ab12cd34.png"
  filename TEXT,
  content_type TEXT,
  width INTEGER, height INTEGER,
  source_host TEXT,             -- which machine registered it
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  screenshot_id TEXT NOT NULL REFERENCES screenshots(id),
  body TEXT NOT NULL,           -- the comment
  x REAL, y REAL, w REAL, h REAL,  -- optional region (0–1 normalised); null = whole-image comment
  author TEXT,                  -- from Access email
  resolved INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE share_links (
  token TEXT PRIMARY KEY,       -- nanoid(21), unguessable
  kind TEXT NOT NULL,           -- 'collection' | 'screenshot'
  target_id TEXT NOT NULL,
  created_by TEXT,              -- Access email
  revoked INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

Share links are DB rows rather than signed HMAC tokens so you can list and **revoke** them from the UI.

### API surface (Worker)
```
POST   /api/collections                 {name, description} → {id, url}
PATCH  /api/collections/:cid            {name?, description?}
GET    /api/collections                 → ordered by updated_at DESC (most recent first)
GET    /api/collections/:cid            → collection + screenshots
POST   /api/collections/:cid/screenshots   (multipart: file) → {id, url}  — also bumps collection.updated_at
GET    /api/screenshots/:sid            → metadata + annotations
GET    /api/screenshots/:sid/annotations → [{body, x, y, w, h, author, resolved, created_at}]
POST   /api/screenshots/:sid/annotations   (from web UI, author = Access email)
PATCH  /api/annotations/:aid            (edit / resolve)
DELETE /api/screenshots/:sid, /api/collections/:cid
POST   /api/collections/:cid/share      → {url: https://…/p/{token}}
POST   /api/screenshots/:sid/share      → {url}
GET    /api/share-links, DELETE /api/share-links/:token   (list / revoke)
GET    /img/:key                        — streams from R2 (auth'd)

# Public (no Access login — see auth note below). Strictly read-only:
GET    /p/:token                        — public viewer page
GET    /p/:token/data                   — collection/screenshot JSON + annotations
GET    /p/:token/img/:key              — image bytes, only if key belongs to the shared target
```

Web URLs (what the MCP returns to Claude Code):
```
https://shots.yourdomain.com/c/kx3f9a            — collection view
https://shots.yourdomain.com/c/kx3f9a/s/ab12cd34 — single screenshot
```

### Web UI features
- Collection list sorted by **most recently updated**, showing description under each name.
- Inside a collection, screenshots grouped into date buckets: **Today · Last 3 days · Last week · Last month · Older** (computed client-side from `created_at`, so it's cheap and timezone-correct for the viewer).
- Click/drag on image to drop a **pin or rectangle annotation**, attach a comment; whole-image comments too. Annotations are multi-user — author comes from the Access login email.
- Comment list with resolve/edit/delete; move screenshots between collections; rename/edit description/delete collections.
- **Share** button on any collection or screenshot → creates a `/p/{token}` link; a share-links page lists active links with revoke. Public viewers see images + annotations but get no annotation input at all (enforced server-side, not just hidden in the UI).

---

## 2. Local MCP server

### Shape
- Small **Node/TypeScript** MCP server using `@modelcontextprotocol/sdk`, **Streamable HTTP transport** on `localhost:8899`. HTTP (not stdio) because the server lives in a long-running container, and any Claude Code session on the machine just connects to the port.
- It is a thin client: reads a file from disk, POSTs it to the Worker API with the service token, returns the URL. No local DB — Cloudflare is the source of truth, so all machines see the same collections.

### Tools
| Tool | Args | Returns |
|---|---|---|
| `create_collection` | `name`, `description` | `{collection_id, url}` |
| `update_collection` | `collection_id`, `name?`, `description?` | ok |
| `list_collections` | — | `[{id, name, description, count, updated_at}]`, most recently updated first — descriptions let an agent decide which collection a new screenshot belongs in, incl. collections another agent created |
| `add_screenshot` | `collection_id`, `file_path`, `filename?` | `{screenshot_id, url}` |
| `list_screenshots` | `collection_id` | `[{id, filename, url, annotation_count}]` |
| `get_annotations` | `screenshot_id` | comments incl. region coords, author, resolved state |
| `get_collection_annotations` | `collection_id` | all annotations across the collection — handy for "apply my feedback" loops |

### The file-path problem (important)
The MCP runs in Docker, so `file_path` refers to the **host** filesystem. The container must mount the places screenshots land:

```yaml
# docker-compose.yml
services:
  screenshot-mcp:
    image: ghcr.io/you/screenshot-mcp:latest
    restart: unless-stopped        # ⇒ starts on boot with Docker
    ports: ["127.0.0.1:8899:8899"]
    environment:
      API_BASE: https://shots.yourdomain.com
      CF_ACCESS_CLIENT_ID: ${CF_ACCESS_CLIENT_ID}
      CF_ACCESS_CLIENT_SECRET: ${CF_ACCESS_CLIENT_SECRET}
    environment:
      # host prefix → container prefix; the MCP uses this to translate paths
      PATH_MAP: "C:\\Dev=/host/dev"
    volumes:
      - C:\Dev:/host/dev:ro        # mount just the one folder you work in
```

On macOS/Linux the same pattern is `- ${HOME}/dev:/host/dev:ro` with `PATH_MAP="/Users/roland/dev=/host/dev"`.

The MCP normalises incoming paths (case-insensitive drive letter, `\` → `/`) and applies the prefix map, so `add_screenshot("kx3f9a", "C:\\Dev\\proj\\shot.png")` resolves to `/host/dev/proj/shot.png`. If a path isn't under a mapped prefix it returns a clear error naming the mounted roots, so the agent knows to save screenshots inside `C:\Dev`. Bind to `127.0.0.1` only — no auth on the MCP itself needed if it's loopback-only.

### Claude Code registration (once per machine)
```bash
claude mcp add --transport http screenshots http://localhost:8899/mcp
```
Or drop it in `.mcp.json` in your project template so happy.engineering picks it up everywhere.

---

## 3. Key flows

**Register a screenshot**
1. Claude Code calls `add_screenshot("kx3f9a", "/Users/roland/proj/shot.png")`.
2. MCP maps the path, reads the file, `POST /api/collections/kx3f9a/screenshots` with service-token headers.
3. Worker writes blob to R2 (`kx3f9a/ab12cd34.png`), inserts D1 row, returns id.
4. MCP returns `https://shots.yourdomain.com/c/kx3f9a/s/ab12cd34` — Claude Code surfaces it, you open it from any device (Access login).

**Feedback loop**
1. You annotate in the web UI ("this button is misaligned", rectangle over the button).
2. Later: Claude Code calls `get_annotations("ab12cd34")` → gets comments + normalised regions → acts on them. Region coords let Claude reason about *where* on the screen the comment applies.

---

## 4. Build phases

1. **Worker + R2 + D1** — schema, upload/list/get endpoints, `/img/` streaming. Deploy with Wrangler; put Access in front (browser policy + one service token). ~Half a day.
2. **MCP server** — tools above, path mapping, Dockerfile + compose. Test with `claude mcp add`. ~Half a day.
3. **Web UI** — collection list (recency order + descriptions), date-bucketed grid, viewer + pin/rect annotations, management. The meatiest part; a Preact SPA served from the same Worker keeps it one deployable.
4. **Sharing** — share_links table, `/p/*` routes, Access bypass policy, revoke UI.
5. **Polish** — `get_collection_annotations`, image dimensions on upload (for accurate region overlay), resolve/unresolve, per-machine service tokens, R2 lifecycle rules if you want auto-expiry of old collections.

## 5. Decided / remaining
- **Language**: TypeScript end to end — Worker, MCP server, and UI.
- **Public sharing**: in scope via `/p/{token}` links (revocable, read-only). Optional later: expiry dates on links.
- **Multi-user annotations**: in scope; `author` from Access email. Public visitors never write.
- **Image variants** — thumbnails via on-the-fly resize in the Worker or Cloudflare Images; skip for v1, date-bucket grid can use full images initially.
