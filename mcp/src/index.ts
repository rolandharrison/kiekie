import express from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { KiekieClient } from './client.js';
import { parsePathMap } from './pathmap.js';
import { createServer } from './server.js';

const PORT = Number(process.env.PORT ?? 8899);
// Bound to all interfaces *inside* the container; docker-compose publishes it to
// 127.0.0.1 only, which is why the MCP itself needs no auth.
const HOST = process.env.HOST ?? '0.0.0.0';

const apiBase = (process.env.API_BASE ?? '').replace(/\/+$/, '');
if (!apiBase) {
  console.error('API_BASE is required (e.g. https://shots.yourdomain.com)');
  process.exit(1);
}

const mappings = parsePathMap(process.env.PATH_MAP);

const client = new KiekieClient({
  apiBase,
  webBase: (process.env.WEB_BASE ?? apiBase).replace(/\/+$/, ''),
  clientId: process.env.CF_ACCESS_CLIENT_ID,
  clientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
});

const app = express();
app.use(express.json({ limit: '4mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, api_base: apiBase, mounted_roots: mappings.map((m) => m.raw) });
});

/**
 * Stateless Streamable HTTP: a fresh server+transport per request. The container
 * is long-lived but sessions are not worth keeping — every Claude Code session on
 * the machine just POSTs to the same port.
 */
app.post('/mcp', async (req, res) => {
  const server = createServer({ client, mappings });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('mcp request failed', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'internal error' },
        id: randomUUID(),
      });
    }
  }
});

// Stateless mode has no server-initiated stream and nothing to terminate.
const notAllowed = (_req: express.Request, res: express.Response) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed: this server is stateless' },
    id: null,
  });
};
app.get('/mcp', notAllowed);
app.delete('/mcp', notAllowed);

app.listen(PORT, HOST, () => {
  console.log(`kiekie MCP listening on http://${HOST}:${PORT}/mcp -> ${apiBase}`);
  if (mappings.length) {
    for (const m of mappings) console.log(`  path map: ${m.raw} -> ${m.container}`);
  } else {
    console.log('  no PATH_MAP set — host paths are used as-is (not running in Docker?)');
  }
});
