# Installing kiekie on another machine

There are two different things people mean by "install kiekie", and only one of
them involves installing anything.

| You want to… | What you need |
|---|---|
| Look at screenshots and leave comments | Nothing. See [Just viewing](#just-viewing). |
| Let Claude Code on *this* machine push screenshots and read comments back | The MCP server. See [Agent machines](#agent-machines). |

The service itself is already deployed at **https://kiekie.example** and is not
per-machine — you are only ever connecting a new client to it.

---

## Just viewing

Nothing to install.

1. Your email address has to be on the Cloudflare Access allow list. Ask the
   account owner to add it (see [Adding a person](#adding-a-person) below).
2. Go to <https://kiekie.example>, type your email, and paste the one-time PIN
   Cloudflare emails you. No Cloudflare account is needed.

Whatever address you sign in with becomes the `author` on the comments you
leave, so use the one people will recognise.

**Public share links (`/p/...`) need none of this** — they bypass Access
entirely and work for anyone, logged in or not. If a colleague only ever needs
to look at one collection, send them a share link instead of adding them to the
login.

---

## Agent machines

This is for a machine where Claude Code should be able to register screenshots.
Claude Code talks to a small MCP server running in Docker on that same machine;
the MCP server is what holds the credential and talks to kiekie.example.

```
Claude Code ──HTTP──► MCP container ──HTTPS + service token──► kiekie.example
 (127.0.0.1:8899)      reads files from a mounted host folder
```

### Prerequisites

- **Docker Desktop** (or Docker Engine + compose plugin) — running.
- **git**.
- **Claude Code**.

Node.js is *not* required: the container builds and runs it.

### 1. Clone the repo

```bash
git clone https://github.com/rolandharrison/kiekie.git
cd kiekie
```

### 2. Get a service token for this machine

The MCP server authenticates to Cloudflare Access with a **service token**.
Give every machine its own — a shared one can't be revoked without cutting off
everybody, and you lose the ability to tell which machine did what.

In the Cloudflare dashboard:

1. **Zero Trust → Access → Service Auth → Service Tokens → Create Service Token**
2. Name it after the machine, e.g. `kiekie-mcp-<hostname>`. Duration: whatever
   you're willing to rotate on.
3. Copy the **Client ID** and **Client Secret** now — the secret is shown once
   and never again.
4. **Zero Trust → Access → Applications → `kiekie` → Policies → `MCP service
   token` → Edit**, and add the new token to the include list. Leave the
   existing entries alone; the list is replaced wholesale when you save.

Do **not** add the token to the `kiekie public share links` or `kiekie static
assets` applications — those are bypass policies and have nothing to
authenticate.

> The token grants full read/write on the API, the same as a logged-in human.
> Treat it like a password.

### 3. Configure the MCP server

```bash
cp mcp/.env.example mcp/.env
```

Then edit `mcp/.env`:

```ini
API_BASE=https://kiekie.example
WEB_BASE=https://kiekie.example
CF_ACCESS_CLIENT_ID=<client id from step 2>
CF_ACCESS_CLIENT_SECRET=<client secret from step 2>

# The folder you work in, and how it appears inside the container.
HOST_WORK_DIR=C:\Dev
PATH_MAP=C:\Dev=/host/dev
```

`HOST_WORK_DIR` and `PATH_MAP` **must agree**, and this is the setting people
get wrong. `HOST_WORK_DIR` is what gets mounted into the container;
`PATH_MAP` is how the MCP rewrites the paths Claude Code hands it into paths
that exist inside the container. Per OS:

| OS | `HOST_WORK_DIR` | `PATH_MAP` |
|---|---|---|
| Windows | `C:\Dev` | `C:\Dev=/host/dev` |
| macOS | `/Users/you/dev` | `/Users/you/dev=/host/dev` |
| Linux | `/home/you/dev` | `/home/you/dev=/host/dev` |

The mount is read-only, and it is the *only* thing the container can see.
Screenshots must be saved somewhere under that folder or the MCP will refuse
them — the error names the mounted roots, so the agent can correct itself.

`mcp/.env` is gitignored. It deliberately holds only the Access service token
and the path mapping, never the Cloudflare API token — the container has no
business being able to deploy.

### 4. Start it

```bash
docker compose -f mcp/docker-compose.yml up -d --build
curl http://127.0.0.1:8899/health
```

The port is published on `127.0.0.1` only, so nothing off this machine can
reach the MCP — which is why the MCP itself needs no authentication of its own.
`restart: unless-stopped` means it comes back after a reboot.

### 5. Register it with Claude Code

Once per machine:

```bash
claude mcp add --transport http --scope user kiekie http://127.0.0.1:8899/mcp
```

### 6. Verify end to end

In a new Claude Code session on that machine, ask it to list the kiekie
collections. A correct result proves all three hops: Claude Code → MCP →
Access → Worker → D1.

Then the real loop: save a screenshot under your mounted folder, have Claude
add it to a collection, open the URL it returns, draw on the image and leave a
comment, and ask Claude to read the annotations back.

---

## Adding a person

Access policies are live Cloudflare state, not repo config — no deploy needed,
and the change takes effect immediately.

**Zero Trust → Access → Applications → `kiekie` → Policies → `Owner` → Edit**,
then add the email to the include list. The whole list is replaced when you
save, so keep the existing entries.

If you find yourself doing this often for one company, replace the individual
emails with a single rule for `emails ending in @yourcompany.com`.

---

## Troubleshooting

**`403` or an HTML login page from the MCP.** The service token isn't on the
`MCP service token` policy of the `kiekie` app, or the client ID/secret in
`mcp/.env` is wrong. Check with:

```bash
curl -H "CF-Access-Client-Id: $ID" -H "CF-Access-Client-Secret: $SECRET" \
  https://kiekie.example/api/me
```

A working token returns `{"identity":{"actor":"service:...","kind":"service"}}`.

**"path is outside the mounted roots".** `PATH_MAP` and the mounted volume
disagree, or the file is genuinely outside `HOST_WORK_DIR`. The error message
lists the roots that *are* readable.

**Changed `mcp/.env` and nothing happened.** Compose reads it at container
creation. `docker compose -f mcp/docker-compose.yml up -d --force-recreate`.

**Port 8899 already in use.** Change both the published port in
`mcp/docker-compose.yml` and the URL you gave `claude mcp add`.

**A blank page on a share link.** The `/assets` bypass application is missing
in Cloudflare — see the Access section of the [README](./README.md). The deploy
smoke test guards against this, so it should not recur.

---

## Working on kiekie itself

Different job — that's the local dev loop, not an install:

```bash
npm install
npm run build --workspace web    # SPA -> worker/public
npm run migrate:local            # D1 schema into the local simulator
npm run dev                      # http://localhost:8787
```

There is no Cloudflare Access locally; the Worker falls back to `DEV_IDENTITY`
(`dev@localhost`) as the caller. See the [README](./README.md) for the full
picture, and [IMPLEMENTATION.md](./IMPLEMENTATION.md) for how it is built.
