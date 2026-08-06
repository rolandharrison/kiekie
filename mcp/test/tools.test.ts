import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { KiekieClient } from '../src/client.js';
import { parsePathMap } from '../src/pathmap.js';
import { createServer } from '../src/server.js';

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let recorded: Recorded[] = [];
let responder: (req: Recorded) => { status?: number; body: unknown } = () => ({ body: {} });

function stubFetch() {
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const req: Recorded = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: (init.headers as Record<string, string>) ?? {},
      body: init.body,
    };
    recorded.push(req);
    const { status = 200, body } = responder(req);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
}

let tmpDir: string;

async function connect(pathMap = `${'/host'}=/host`) {
  const client = new KiekieClient({
    apiBase: 'https://shots.example.com',
    webBase: 'https://shots.example.com',
    clientId: 'cid.access',
    clientSecret: 'secret',
  });
  const server = createServer({
    client,
    mappings: parsePathMap(pathMap),
    hostname: 'test-machine',
  });
  const mcp = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  return mcp;
}

function textOf(result: any): string {
  return result.content.map((c: any) => c.text).join('\n');
}

beforeEach(async () => {
  recorded = [];
  stubFetch();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiekie-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('tool surface', () => {
  it('exposes exactly the seven designed tools', async () => {
    const mcp = await connect();
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_screenshot',
      'create_collection',
      'get_annotations',
      'get_collection_annotations',
      'list_collections',
      'list_screenshots',
      'update_collection',
    ]);
  });
});

describe('create_collection', () => {
  it('posts name and description and returns the collection url', async () => {
    responder = () => ({ body: { id: 'kx3f9a', name: 'UI', description: 'pass 1' } });
    const mcp = await connect();

    const result = await mcp.callTool({
      name: 'create_collection',
      arguments: { name: 'UI', description: 'pass 1' },
    });

    expect(recorded[0].url).toBe('https://shots.example.com/api/collections');
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body as string)).toEqual({ name: 'UI', description: 'pass 1' });
    expect(JSON.parse(textOf(result))).toEqual({
      collection_id: 'kx3f9a',
      url: 'https://shots.example.com/c/kx3f9a',
    });
  });

  it('sends the Access service-token headers', async () => {
    responder = () => ({ body: { id: 'kx3f9a' } });
    const mcp = await connect();
    await mcp.callTool({ name: 'create_collection', arguments: { name: 'UI' } });

    expect(recorded[0].headers['CF-Access-Client-Id']).toBe('cid.access');
    expect(recorded[0].headers['CF-Access-Client-Secret']).toBe('secret');
  });

  it('surfaces an API error as a tool error rather than throwing', async () => {
    responder = () => ({ status: 400, body: { error: 'name is required' } });
    const mcp = await connect();

    const result: any = await mcp.callTool({ name: 'create_collection', arguments: { name: 'x' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('name is required');
  });
});

describe('update_collection', () => {
  it('sends only the fields provided', async () => {
    responder = () => ({ body: { id: 'kx3f9a' } });
    const mcp = await connect();

    await mcp.callTool({
      name: 'update_collection',
      arguments: { collection_id: 'kx3f9a', description: 'new purpose' },
    });

    expect(recorded[0].method).toBe('PATCH');
    expect(JSON.parse(recorded[0].body as string)).toEqual({ description: 'new purpose' });
  });
});

describe('list_collections', () => {
  it('returns id, name, description, count and url', async () => {
    responder = () => ({
      body: {
        collections: [
          { id: 'aaa111', name: 'Recent', description: 'newest work', screenshot_count: 3, updated_at: '2026-07-31 10:00:00' },
          { id: 'bbb222', name: 'Older', description: null, screenshot_count: 0, updated_at: '2026-07-30 10:00:00' },
        ],
      },
    });
    const mcp = await connect();

    const parsed = JSON.parse(textOf(await mcp.callTool({ name: 'list_collections', arguments: {} })));
    expect(parsed).toEqual([
      {
        id: 'aaa111',
        name: 'Recent',
        description: 'newest work',
        count: 3,
        updated_at: '2026-07-31 10:00:00',
        url: 'https://shots.example.com/c/aaa111',
      },
      {
        id: 'bbb222',
        name: 'Older',
        description: null,
        count: 0,
        updated_at: '2026-07-30 10:00:00',
        url: 'https://shots.example.com/c/bbb222',
      },
    ]);
  });
});

describe('add_screenshot', () => {
  it('maps the host path, uploads the bytes and returns the screenshot url', async () => {
    const file = path.join(tmpDir, 'shot.png');
    await fs.writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    responder = () => ({ body: { id: 'ab12cd34', collection_id: 'kx3f9a', width: 800, height: 600 } });
    const mcp = await connect(`C:\\Dev=${tmpDir.replace(/\\/g, '/')}`);

    const result = await mcp.callTool({
      name: 'add_screenshot',
      arguments: { collection_id: 'kx3f9a', file_path: 'C:\\Dev\\shot.png' },
    });

    expect(recorded[0].url).toBe('https://shots.example.com/api/collections/kx3f9a/screenshots');
    const form = recorded[0].body as FormData;
    expect(form.get('filename')).toBe('shot.png');
    expect(form.get('source_host')).toBe('test-machine');
    expect(JSON.parse(textOf(result))).toEqual({
      screenshot_id: 'ab12cd34',
      url: 'https://shots.example.com/c/kx3f9a/s/ab12cd34',
      width: 800,
      height: 600,
    });
  });

  it('honours a filename override', async () => {
    await fs.writeFile(path.join(tmpDir, 'shot.png'), Buffer.from([1, 2, 3]));
    responder = () => ({ body: { id: 'ab12cd34', collection_id: 'kx3f9a' } });
    const mcp = await connect(`C:\\Dev=${tmpDir.replace(/\\/g, '/')}`);

    await mcp.callTool({
      name: 'add_screenshot',
      arguments: { collection_id: 'kx3f9a', file_path: 'C:\\Dev\\shot.png', filename: 'login-page.png' },
    });

    expect((recorded[0].body as FormData).get('filename')).toBe('login-page.png');
  });

  it('forwards the description to the upload', async () => {
    await fs.writeFile(path.join(tmpDir, 'shot.png'), Buffer.from([1, 2, 3]));
    responder = () => ({ body: { id: 'ab12cd34', collection_id: 'kx3f9a' } });
    const mcp = await connect(`C:\\Dev=${tmpDir.replace(/\\/g, '/')}`);

    await mcp.callTool({
      name: 'add_screenshot',
      arguments: {
        collection_id: 'kx3f9a',
        file_path: 'C:\\Dev\\shot.png',
        description: 'login page after the retry fix',
      },
    });

    expect((recorded[0].body as FormData).get('description')).toBe('login page after the retry fix');
  });

  it('tells the agent where screenshots must live when the path is unmapped', async () => {
    const mcp = await connect('C:\\Dev=/host/dev');
    const result: any = await mcp.callTool({
      name: 'add_screenshot',
      arguments: { collection_id: 'kx3f9a', file_path: 'D:\\Elsewhere\\shot.png' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('not under any mounted root');
    expect(textOf(result)).toContain('C:\\Dev');
    expect(recorded).toHaveLength(0);
  });

  it('reports a missing file clearly', async () => {
    const mcp = await connect(`C:\\Dev=${tmpDir.replace(/\\/g, '/')}`);
    const result: any = await mcp.callTool({
      name: 'add_screenshot',
      arguments: { collection_id: 'kx3f9a', file_path: 'C:\\Dev\\absent.png' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('file not found');
  });
});

describe('list_screenshots', () => {
  it('returns per-screenshot urls and annotation counts', async () => {
    responder = () => ({
      body: {
        collection: { id: 'kx3f9a', name: 'UI' },
        screenshots: [
          { id: 'ab12cd34', filename: 'home.png', description: 'the landing page', created_at: '2026-07-31 09:00:00', annotation_count: 2, width: 1, height: 1 },
        ],
      },
    });
    const mcp = await connect();

    const parsed = JSON.parse(textOf(await mcp.callTool({ name: 'list_screenshots', arguments: { collection_id: 'kx3f9a' } })));
    expect(parsed).toEqual([
      {
        id: 'ab12cd34',
        filename: 'home.png',
        description: 'the landing page',
        url: 'https://shots.example.com/c/kx3f9a/s/ab12cd34',
        annotation_count: 2,
        created_at: '2026-07-31 09:00:00',
      },
    ]);
  });
});

describe('annotation reads', () => {
  it('returns region coords, author and resolved state for one screenshot', async () => {
    const annotation = {
      id: 'an1', screenshot_id: 'ab12cd34', body: 'button is misaligned',
      x: 0.1, y: 0.2, w: 0.3, h: 0.05, author: 'roland@example.com',
      resolved: false, created_at: '2026-07-31 09:05:00',
    };
    responder = () => ({ body: { annotations: [annotation] } });
    const mcp = await connect();

    const parsed = JSON.parse(textOf(await mcp.callTool({ name: 'get_annotations', arguments: { screenshot_id: 'ab12cd34' } })));
    expect(recorded[0].url).toBe('https://shots.example.com/api/screenshots/ab12cd34/annotations');
    expect(parsed).toEqual([annotation]);
  });

  it('gathers annotations across a whole collection', async () => {
    responder = () => ({ body: { annotations: [{ id: 'an1', body: 'x', screenshot_filename: 'home.png' }] } });
    const mcp = await connect();

    const parsed = JSON.parse(
      textOf(await mcp.callTool({ name: 'get_collection_annotations', arguments: { collection_id: 'kx3f9a' } })),
    );
    expect(recorded[0].url).toBe('https://shots.example.com/api/collections/kx3f9a/annotations');
    expect(parsed[0].screenshot_filename).toBe('home.png');
  });
});
