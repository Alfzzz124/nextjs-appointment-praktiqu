/**
 * Vitest setup: load `.env.test.local` into process.env BEFORE any test module
 * (and therefore before `@/lib/db` instantiates the Prisma client).
 *
 * Zero-dependency parser — the repo has no direct `dotenv` dependency. Only
 * sets keys that are not already present in the environment, so an explicit
 * `DATABASE_URL=... vitest` invocation still wins.
 *
 * The integration fixtures additionally guard on the DB name containing "test"
 * (see tests/billing/fixtures.ts) so they can never run against the live DB.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_FILE = resolve(process.cwd(), '.env.test.local');

try {
  const raw = readFileSync(ENV_FILE, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  // No .env.test.local — integration tests will self-skip via assertTestDb().
}
