import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { unique } from './helpers';

/**
 * Full-loop check: the real MCP server binary, talking to the real Worker, with
 * the screenshot it registers then appearing (and being annotatable) in the
 * browser UI. The unit tests stub fetch; this one does not.
 */
const MCP_PORT = 8901;
const MCP_URL = `http://127.0.0.1:${MCP_PORT}/mcp`;
const ROOT = process.cwd();

let mcp: ChildProcess;

async function rpc(method: string, params: unknown, id = Math.floor(Math.random() * 1e6)) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const text = await res.text();
  const line = text
    .split('\n')
    .find((l) => l.startsWith('data: '))
    ?.slice(6);
  return JSON.parse(line ?? text);
}

async function callTool(name: string, args: Record<string, unknown>) {
  const response = await rpc('tools/call', { name, arguments: args });
  const body = response.result.content.map((c: any) => c.text).join('\n');
  return { isError: Boolean(response.result.isError), text: body };
}

test.beforeAll(async () => {
  mcp = spawn(process.execPath, [path.join(ROOT, 'mcp', 'dist', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(MCP_PORT),
      HOST: '127.0.0.1',
      API_BASE: 'http://127.0.0.1:8788',
      WEB_BASE: 'http://127.0.0.1:8788',
      // Only the fixtures folder is "mounted", exactly as a Docker volume would be.
      PATH_MAP: `C:\\HostShots=${path.join(ROOT, 'e2e', 'fixtures').replace(/\\/g, '/')}`,
    },
    stdio: 'ignore',
  });

  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${MCP_PORT}/health`);
      if (res.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('MCP server did not start');
    await new Promise((r) => setTimeout(r, 250));
  }

  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '1.0.0' },
  });
});

test.afterAll(() => {
  mcp?.kill();
});

test('registers a screenshot through MCP and reads annotations back', async ({ page }) => {
  const name = unique('Agent capture');

  const created = await callTool('create_collection', {
    name,
    description: 'created by Claude Code via MCP',
  });
  expect(created.isError).toBe(false);
  const cid = JSON.parse(created.text).collection_id as string;

  const added = await callTool('add_screenshot', {
    collection_id: cid,
    file_path: 'C:\\HostShots\\screen-a.png',
  });
  expect(added.isError).toBe(false);
  const uploaded = JSON.parse(added.text);
  expect(uploaded.width).toBe(400);
  expect(uploaded.height).toBe(300);
  expect(uploaded.url).toBe(`http://127.0.0.1:8788/c/${cid}/s/${uploaded.screenshot_id}`);

  // The URL the MCP handed back opens the real screenshot in the web UI.
  await page.goto(`/c/${cid}/s/${uploaded.screenshot_id}`);
  await expect(page.getByTestId('screenshot-title')).toHaveText('screen-a.png');
  const rendered = await page
    .getByTestId('screenshot-image')
    .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth);
  expect(rendered).toBe(400);

  // A human annotates a region…
  await page.getByTestId('whole-comment-input').fill('tighten the header spacing');
  await page.getByTestId('whole-comment-submit').click();
  await expect(page.getByTestId('comment-count')).toHaveText('1');

  // …and the agent reads it straight back.
  const annotations = await callTool('get_annotations', {
    screenshot_id: uploaded.screenshot_id,
  });
  const parsed = JSON.parse(annotations.text);
  expect(parsed).toHaveLength(1);
  expect(parsed[0].body).toBe('tighten the header spacing');
  expect(parsed[0].author).toBe('dev@localhost');

  const collectionWide = await callTool('get_collection_annotations', { collection_id: cid });
  expect(JSON.parse(collectionWide.text)[0].screenshot_filename).toBe('screen-a.png');

  const listed = await callTool('list_screenshots', { collection_id: cid });
  expect(JSON.parse(listed.text)[0].annotation_count).toBe(1);

  const collections = await callTool('list_collections', {});
  const entry = JSON.parse(collections.text).find((c: any) => c.id === cid);
  expect(entry.description).toBe('created by Claude Code via MCP');
  expect(entry.count).toBe(1);
});

test('refuses a path outside the mounted roots and says where to save instead', async () => {
  const result = await callTool('add_screenshot', {
    collection_id: 'whatever',
    file_path: 'D:\\Unmounted\\shot.png',
  });
  expect(result.isError).toBe(true);
  expect(result.text).toContain('not under any mounted root');
  expect(result.text).toContain('C:\\HostShots');
});

test('reports a missing file inside a mounted root', async () => {
  const result = await callTool('add_screenshot', {
    collection_id: 'whatever',
    file_path: 'C:\\HostShots\\does-not-exist.png',
  });
  expect(result.isError).toBe(true);
  expect(result.text).toContain('file not found');
});
