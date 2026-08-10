import type { Env as WorkerEnv } from '../src/env';
import type { D1Migration } from 'cloudflare:test';

// @cloudflare/vitest-pool-workers ≥0.20 types the `env` export from
// "cloudflare:test" as the global `Cloudflare.Env` (it used to be
// `ProvidedEnv`). Declare our bindings there, plus the migrations array the
// vitest config injects for `applyD1Migrations`.
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
