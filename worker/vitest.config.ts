import path from 'node:path';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        singleWorker: true,
        // The pool's per-test storage stack is unreliable against the R2
        // simulator on Windows; tests reset their own state instead.
        isolatedStorage: false,
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
      },
    },
  },
});
