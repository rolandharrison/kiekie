import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));

// vitest-pool-workers ≥0.13 is a Vite plugin (`cloudflareTest`) rather than the
// old `defineWorkersConfig` wrapper. Bindings pass straight through to
// miniflare; the migrations array is read by `applyD1Migrations` in tests.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          // Local mode: DEV_IDENTITY supplies the caller so the suite runs
          // without a Zero Trust tenant. Auth-specific tests override this.
          TRUST_ACCESS_HEADERS: '',
          DEV_IDENTITY: 'tester@example.com',
          WEB_BASE: 'https://shots.example.com',
        },
      },
    }),
  ],
});
