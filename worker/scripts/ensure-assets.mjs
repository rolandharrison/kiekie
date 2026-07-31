/**
 * `worker/public` is a build artifact (Vite writes the SPA there), but
 * `wrangler.toml` declares it as the assets directory — so on a fresh clone the
 * test pool refuses to start, and with the directory present but empty the
 * app-shell routes 404 instead of serving a page.
 *
 * Rather than making the test suite depend on having run a build first, this
 * guarantees a minimal shell exists. A real `vite build` overwrites it; we never
 * clobber an already-built file.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'public');
const shell = join(dir, 'index.html');

mkdirSync(dir, { recursive: true });
if (!existsSync(shell)) {
  writeFileSync(shell, '<!doctype html><title>kiekie</title><div id="app"></div>\n');
}
