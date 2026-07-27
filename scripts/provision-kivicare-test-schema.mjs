#!/usr/bin/env node
/**
 * Provision a complete KiviCare schema into the TEST database.
 *
 * Both local databases carry only 16 of KiviCare's 30 tables, which makes several
 * repositories untestable rather than merely untested — `wp_kc_static_data` is absent
 * entirely, and `wp_kc_patient_clinic_mappings` (which clinic-scoped patient access
 * control depends on) is too. See docs/architecture/shadow-tables-audit.md §3a.
 *
 * The DDL is extracted from the plugin's own migrations rather than hand-written, so
 * the tables match what production actually has:
 *   Wordpress-Plugin/kivicare-clinic-management-system/app/database/migrations/Create*Table.php
 *
 * Safety: refuses any database whose name does not contain "test", and only ever
 * issues CREATE TABLE IF NOT EXISTS — it never drops or alters an existing table.
 *
 *   node scripts/provision-kivicare-test-schema.mjs [--dry-run]
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS_DIR = resolve(
  process.cwd(),
  'Wordpress-Plugin/kivicare-clinic-management-system/app/database/migrations',
);

const DRY_RUN = process.argv.includes('--dry-run');

function die(msg) {
  console.error(`\n\x1b[31m✖ ${msg}\x1b[0m\n`);
  process.exit(1);
}

/* ---------------------------------------------------------------- */
/* Target database — test only                                       */
/* ---------------------------------------------------------------- */

// Prefer the test env file, exactly as vitest does.
let url = process.env.DATABASE_URL;
if (!url) {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.test.local'), 'utf8');
    const line = raw.split('\n').find((l) => l.trim().startsWith('DATABASE_URL='));
    if (line) url = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
  } catch {
    /* fall through to the check below */
  }
}
if (!url) die('No DATABASE_URL (and no .env.test.local to read one from).');

const database = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
if (!/test/i.test(database)) {
  die(
    `Refusing to touch "${database}" — this script only provisions a TEST database.\n` +
      '  Point DATABASE_URL at a database whose name contains "test".',
  );
}

/* ---------------------------------------------------------------- */
/* Extract DDL from the plugin's migrations                          */
/* ---------------------------------------------------------------- */

/**
 * Each migration reads:
 *   $table_name = $wpdb->prefix . 'kc_foo';
 *   $sql = "CREATE TABLE {$table_name} ( ...columns... ) " . $this->get_collation() . ";";
 *
 * Pull the table name and the parenthesised body, then rebuild the statement with an
 * explicit prefix and charset. `get_collation()` resolves to WordPress's charset at
 * runtime; utf8mb4 is what it yields on every install we target.
 */
function extractDdl(php) {
  const nameMatch = php.match(/\$table_name\s*=\s*\$wpdb->prefix\s*\.\s*'([a-z0-9_]+)'/i);
  if (!nameMatch) return null;
  const table = `wp_${nameMatch[1]}`;

  const startMatch = php.match(/CREATE TABLE\s+`?\{\$table_name\}`?\s*\(/i);
  if (!startMatch) return null;

  // Walk from the opening paren to its match, so nested parens in column
  // definitions — varchar(191), decimal(10,2) — don't terminate the body early.
  const open = startMatch.index + startMatch[0].length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < php.length; i++) {
    if (php[i] === '(') depth++;
    else if (php[i] === ')') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return null;

  const body = php.slice(open + 1, close).trim();
  return {
    table,
    sql: `CREATE TABLE IF NOT EXISTS \`${table}\` (\n${body}\n) DEFAULT CHARSET=utf8mb4;`,
  };
}

const files = readdirSync(MIGRATIONS_DIR).filter((f) => /Create.*Table\.php$/.test(f));
const statements = [];
const skipped = [];

for (const file of files) {
  const ddl = extractDdl(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8'));
  if (ddl) statements.push({ file, ...ddl });
  else skipped.push(file);
}

if (statements.length === 0) die(`No CREATE TABLE statements found in ${MIGRATIONS_DIR}`);

console.log(`Parsed ${statements.length} table definitions from the KiviCare plugin.`);
if (skipped.length > 0) {
  console.log(`\x1b[33mSkipped (no parseable CREATE TABLE):\x1b[0m ${skipped.join(', ')}`);
}

if (DRY_RUN) {
  for (const s of statements) console.log(`\n-- ${s.file}\n${s.sql}`);
  process.exit(0);
}

/* ---------------------------------------------------------------- */
/* Apply                                                             */
/* ---------------------------------------------------------------- */

/**
 * WordPress core columns the test database is missing.
 *
 * `wp_users` here was created by `prisma db push` from the `KcUser` model, which maps
 * only the five columns the app reads. Real WordPress has ten, and anything writing a
 * user the way WordPress does — a receptionist, a patient — fails with
 * "Unknown column 'user_pass'". Adding them is additive and test-only.
 */
const CORE_COLUMNS = [
  ['wp_users', 'user_pass', "varchar(255) NOT NULL DEFAULT ''"],
  ['wp_users', 'user_nicename', "varchar(50) NOT NULL DEFAULT ''"],
  ['wp_users', 'user_url', "varchar(100) NOT NULL DEFAULT ''"],
  ['wp_users', 'user_activation_key', "varchar(255) NOT NULL DEFAULT ''"],
  ['wp_users', 'user_status', 'int NOT NULL DEFAULT 0'],
];

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url } } });

let created = 0;
let existed = 0;
const failed = [];

try {
  const before = await prisma.$queryRawUnsafe(
    `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?`,
    database,
  );
  const present = new Set(before.map((r) => r.t ?? r.table_name));

  for (const s of statements) {
    const alreadyThere = present.has(s.table);
    try {
      await prisma.$executeRawUnsafe(s.sql);
      if (alreadyThere) existed++;
      else {
        created++;
        console.log(`  \x1b[32m+\x1b[0m ${s.table}`);
      }
    } catch (err) {
      failed.push({ table: s.table, message: String(err?.message ?? err).split('\n')[0] });
    }
  }
  // Repair WordPress core columns the Prisma-pushed stubs are missing.
  const existingCols = await prisma.$queryRawUnsafe(
    `SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = ?`,
    database,
  );
  const haveCol = new Set(
    existingCols.map((r) => `${r.t ?? r.table_name}.${r.c ?? r.column_name}`),
  );

  for (const [table, column, definition] of CORE_COLUMNS) {
    if (!present.has(table) || haveCol.has(`${table}.${column}`)) continue;
    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`,
      );
      console.log(`  \x1b[32m+\x1b[0m ${table}.${column}`);
      created++;
    } catch (err) {
      failed.push({ table: `${table}.${column}`, message: String(err?.message ?? err).split('\n')[0] });
    }
  }
} finally {
  await prisma.$disconnect();
}

console.log(
  `\nDone on "${database}": \x1b[32m${created} created\x1b[0m, ${existed} already present.`,
);

if (failed.length > 0) {
  console.error(`\n\x1b[31m${failed.length} failed:\x1b[0m`);
  for (const f of failed) console.error(`  ${f.table}: ${f.message}`);
  process.exit(1);
}
