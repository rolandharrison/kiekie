import fs from 'node:fs/promises';
import os from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { KiekieClient } from './client.js';
import { mapPath, type Mapping } from './pathmap.js';

export interface ServerDeps {
  client: KiekieClient;
  mappings: Mapping[];
  hostname?: string;
}

function text(value: unknown) {
  return {
    content: [
      { type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
    ],
  };
}

function failure(error: unknown) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
  };
}

export function createServer({ client, mappings, hostname = os.hostname() }: ServerDeps): McpServer {
  const server = new McpServer(
    { name: 'kiekie', version: '1.0.0' },
    {
      instructions:
        'Register screenshots with the kiekie service and read back human annotations. ' +
        'Call list_collections first: each collection has a description explaining what it is for, ' +
        'including collections created by other agents or machines.',
    },
  );

  server.registerTool(
    'create_collection',
    {
      title: 'Create collection',
      description:
        'Create a new screenshot collection. The description should explain what the collection is for so other agents can route screenshots to it.',
      inputSchema: {
        name: z.string().min(1).describe('Human-readable collection name'),
        description: z.string().optional().describe('Purpose/context for this collection'),
      },
    },
    async ({ name, description }) => {
      try {
        const created = await client.createCollection(name, description);
        return text({ collection_id: created.id, url: client.collectionUrl(created.id) });
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    'update_collection',
    {
      title: 'Update collection',
      description: 'Rename a collection or change its description.',
      inputSchema: {
        collection_id: z.string().min(1),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
      },
    },
    async ({ collection_id, name, description }) => {
      try {
        const patch: { name?: string; description?: string } = {};
        if (name !== undefined) patch.name = name;
        if (description !== undefined) patch.description = description;
        await client.updateCollection(collection_id, patch);
        return text({ ok: true, url: client.collectionUrl(collection_id) });
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    'list_collections',
    {
      title: 'List collections',
      description:
        'List every collection, most recently updated first, with descriptions and screenshot counts. Use the descriptions to decide where a new screenshot belongs.',
      inputSchema: {},
    },
    async () => {
      try {
        const { collections } = await client.listCollections();
        return text(
          collections.map((c) => ({
            id: c.id,
            name: c.name,
            description: c.description,
            count: c.screenshot_count,
            updated_at: c.updated_at,
            url: client.collectionUrl(c.id),
          })),
        );
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    'add_screenshot',
    {
      title: 'Add screenshot',
      description:
        'Upload a screenshot file from this machine into a collection and return its web URL. file_path is a host path; it must live under one of the mounted roots.',
      inputSchema: {
        collection_id: z.string().min(1),
        file_path: z.string().min(1).describe('Absolute path to the image on the host machine'),
        filename: z.string().optional().describe('Override the stored filename'),
      },
    },
    async ({ collection_id, file_path, filename }) => {
      try {
        const resolved = mapPath(file_path, mappings);
        const bytes = await fs.readFile(resolved);
        const name = filename ?? resolved.split('/').pop() ?? 'screenshot.png';
        const created = await client.addScreenshot(collection_id, bytes, name, hostname);
        return text({
          screenshot_id: created.id,
          url: client.screenshotUrl(created.collection_id, created.id),
          width: created.width,
          height: created.height,
        });
      } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
          return failure(new Error(`file not found inside the container: ${file_path}`));
        }
        return failure(e);
      }
    },
  );

  server.registerTool(
    'list_screenshots',
    {
      title: 'List screenshots',
      description: 'List the screenshots in a collection with their URLs and annotation counts.',
      inputSchema: { collection_id: z.string().min(1) },
    },
    async ({ collection_id }) => {
      try {
        const data = await client.getCollection(collection_id);
        return text(
          data.screenshots.map((s) => ({
            id: s.id,
            filename: s.filename,
            url: client.screenshotUrl(collection_id, s.id),
            annotation_count: s.annotation_count,
            created_at: s.created_at,
          })),
        );
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    'get_annotations',
    {
      title: 'Get annotations',
      description:
        'Read the comments on one screenshot. Region coordinates are normalised 0–1 (x, y, w, h); a zero-size region is a pin, and nulls mean the comment is about the whole image.',
      inputSchema: { screenshot_id: z.string().min(1) },
    },
    async ({ screenshot_id }) => {
      try {
        const { annotations } = await client.getAnnotations(screenshot_id);
        return text(annotations);
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    'get_collection_annotations',
    {
      title: 'Get all annotations in a collection',
      description:
        'Read every comment across a collection in one call — the "apply my feedback" loop.',
      inputSchema: { collection_id: z.string().min(1) },
    },
    async ({ collection_id }) => {
      try {
        const { annotations } = await client.getCollectionAnnotations(collection_id);
        return text(annotations);
      } catch (e) {
        return failure(e);
      }
    },
  );

  return server;
}
