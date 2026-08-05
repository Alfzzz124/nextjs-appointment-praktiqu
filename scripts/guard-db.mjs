#!/usr/bin/env node
/**
 * Refuses to let a schema-mutating Prisma command touch a WordPress database.
 *
 * Background: DATABASE_URL points at the *live WordPress database* — the same
 * one KiviCare owns. A previous `prisma db push` against it silently created 40
 * duplicate tables (see docs/architecture/shadow-tables-audit.md). There is no
 * `_prisma_migrations` table, so Prisma has no history to protect us.
 *
 * Usage:
 *   node scripts/guard-db.mjs            # exits 1 if the target DB is a WP DB
 *   npm run db:push                      # guard runs first, then prisma db push
 *
 * Escape hatch (deliberate, loud, and logged):
 *   ALLOW_WP_SCHEMA_WRITE=i-have-a-backup npm run db:push
 */

const SENTINEL_TABLES = ['wp_users', 'wp_usermeta', 'wp_options'];
const OVERRIDE = 'i-have-a-backup';

function fail(lines) {
  console.error('\n\x1b[31m✖ guard-db: refusing to run\x1b[0m\n');
  for (const line of lines) console.error('  ' + line);
  console.error('');
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  fail([
    'DATABASE_URL is not set.',
    'Refusing to guess which database a schema command would hit.',
  ]);
}

let parsed;
try {
  parsed = new URL(url);
} catch {
  fail([`DATABASE_URL is not a valid URL: ${url.replace(/:[^:@/]*@/, ':***@')}`]);
}

const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
const host = parsed.hostname;
const port = parsed.port || '3306';

if (!database) {
  fail(['DATABASE_URL has no database name in its path.']);
}

/**
 * Probe information_schema for the WordPress sentinel tables.
 *
 * Uses PrismaClient rather than the `mysql` CLI: the CLI is frequently absent
 * (e.g. when MySQL runs in Docker and the host has no client), and a guard that
 * cannot run is a guard that gets bypassed. @prisma/client is a hard dependency
 * and `postinstall` generates it, so it is always present.
 */
async function findSentinelTables() {
  let PrismaClient;
  try {
    ({ PrismaClient } = await import('@prisma/client'));
  } catch {
    fail([
      '@prisma/client is not available, so the WordPress check could not run.',
      'Refusing to proceed blind against a database that may be the live WP DB.',
      '',
      'Run `npm install` first.',
    ]);
  }

  const prisma = new PrismaClient({
    datasources: { db: { url } },
    log: [],
  });

  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT table_name AS t FROM information_schema.tables
       WHERE table_schema = ? AND table_name IN (${SENTINEL_TABLES.map(() => '?').join(',')})`,
      database,
      ...SENTINEL_TABLES,
    );
    return rows.map((r) => r.t ?? r.table_name).filter(Boolean);
  } catch (err) {
    fail([
      'Could not reach the database to verify it is safe to modify.',
      String(err?.message ?? err).split('\n')[0],
    ]);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

const found = await findSentinelTables();

if (found.length === 0) {
  console.log(`\x1b[32m✔ guard-db:\x1b[0m ${database}@${host} has no WordPress tables — safe.`);
  process.exit(0);
}

if (process.env.ALLOW_WP_SCHEMA_WRITE === OVERRIDE) {
  console.warn(
    `\n\x1b[33m⚠ guard-db: OVERRIDE ACTIVE\x1b[0m — writing schema to WordPress DB ` +
      `"${database}@${host}" (found: ${found.join(', ')}).\n` +
      `  You asserted a backup exists. This is on the record.\n`,
  );
  process.exit(0);
}

fail([
  `"${database}" on ${host}:${port} is a \x1b[1mWordPress database\x1b[0m.`,
  `Found: ${found.join(', ')}`,
  '',
  'Prisma schema commands (db push, migrate dev, migrate reset) would create or drop',
  'tables in the database KiviCare owns. That is how the 40 duplicate shadow tables',
  'got there in the first place.',
  '',
  'What to do instead:',
  '  • Changing one of our own tables? Write a scoped ALTER/CREATE for that table only,',
  '    review it, and apply it deliberately.',
  '  • Need a clean schema to experiment on? Point DATABASE_URL at a scratch database.',
  '',
  'See docs/architecture/shadow-tables-audit.md §5 Phase 0.',
  '',
  'If you are certain and have a verified backup:',
  `  ALLOW_WP_SCHEMA_WRITE=${OVERRIDE} <your command>`,
]);
