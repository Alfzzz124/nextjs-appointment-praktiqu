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

/**
 * Optional reference database to copy missing columns from, e.g.
 *   node scripts/provision-kivicare-test-schema.mjs --reference praktiqu
 *
 * CREATE TABLE alone is not enough for fidelity: KiviCare also ships imperative
 * `Add*` migrations that ALTER tables afterwards (six columns on
 * wp_kc_clinic_schedule alone). Parsing those is brittle — they are PHP with
 * conditionals — so a restored production copy is used as ground truth instead.
 * Columns are only ever ADDed; nothing is altered or dropped.
 */
const refIndex = process.argv.indexOf('--reference');
const REFERENCE_DB = refIndex !== -1 ? process.argv[refIndex + 1] : null;

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

/**
 * Tables that predate this script were created by `prisma db push` from the Kc* models,
 * whose `id BigInt @id` carries no autoincrement. KiviCare's real DDL declares
 * AUTO_INCREMENT, so inserts that omit the id — which is how every KiviCare write
 * works — fail with "Field 'id' doesn't have a default value". Repaired here rather
 * than worked around in each test.
 */
const AUTOINCREMENT_TABLES = [
  'wp_kc_appointments',
  'wp_kc_clinic_sessions',
  'wp_kc_clinics',
  'wp_kc_doctor_clinic_mappings',
  'wp_kc_service_doctor_mapping',
  'wp_kc_service_sessions',
  'wp_kc_services',
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

  // Restore AUTO_INCREMENT where `prisma db push` dropped it.
  const noAutoInc = await prisma.$queryRawUnsafe(
    `SELECT table_name AS t FROM information_schema.columns
      WHERE table_schema = ? AND column_name = 'id'
        AND table_name LIKE 'wp\\_kc\\_%' AND extra NOT LIKE '%auto_increment%'`,
    database,
  );
  for (const row of noAutoInc) {
    const table = row.t ?? row.table_name;
    if (!AUTOINCREMENT_TABLES.includes(table)) continue;
    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE \`${table}\` MODIFY COLUMN \`id\` bigint NOT NULL AUTO_INCREMENT`,
      );
      console.log(`  \x1b[32m~\x1b[0m ${table}.id AUTO_INCREMENT restored`);
      created++;
    } catch (err) {
      failed.push({ table: `${table}.id`, message: String(err?.message ?? err).split('\n')[0] });
    }
  }

  // Copy whole tables the reference has and this one lacks, then any missing columns.
  if (REFERENCE_DB) {
    if (REFERENCE_DB === database) die('--reference must name a DIFFERENT database.');

    /**
     * Some tables exist only in production: the followup, rating and GDPR features ship
     * no DDL in this repo, and KiviCare add-ons (telemed, custom forms) create their own.
     * Tests that touch them were reported as SKIPPED rather than failed, so the suite
     * looked green while they never ran.
     *
     * Structure only — no rows are copied, and only tables absent here are created.
     * Restricted to wp_kc_* plus an explicit list of WordPress core tables the tests
     * need, so this cannot pull in the whole of an unrelated production database.
     */
    const CORE_TABLES = ['wp_posts', 'wp_postmeta', 'wp_terms', 'wp_term_taxonomy'];

    const missingTables = await prisma.$queryRawUnsafe(
      `SELECT table_name AS t FROM information_schema.tables r
        WHERE r.table_schema = ?
          AND (r.table_name LIKE 'wp\\_kc\\_%' OR r.table_name IN (${CORE_TABLES.map(() => '?').join(',')}))
          AND r.table_name NOT IN (
            SELECT table_name FROM information_schema.tables WHERE table_schema = ?
          )
        ORDER BY r.table_name`,
      REFERENCE_DB,
      ...CORE_TABLES,
      database,
    );

    for (const row of missingTables) {
      const table = row.t ?? row.table_name;
      // CREATE TABLE ... LIKE copies the full definition including indexes and
      // AUTO_INCREMENT, without copying a single row.
      const createLike = `CREATE TABLE \`${database}\`.\`${table}\` LIKE \`${REFERENCE_DB}\`.\`${table}\``;

      try {
        await prisma.$executeRawUnsafe(createLike);
        console.log(`  \x1b[32m+\x1b[0m ${table} (structure from ${REFERENCE_DB})`);
        created++;
      } catch (err) {
        const msg = String(err?.message ?? err);

        // WordPress core tables carry '0000-00-00' defaults that this server's
        // sql_mode rejects (error 1067). Retry with the zero-date restrictions lifted
        // for that one connection — the schema must match production, not this
        // server's stricter defaults. $transaction pins the connection so the
        // SET SESSION actually applies to the CREATE.
        if (msg.includes('1067')) {
          try {
            await prisma.$transaction(async (tx) => {
              await tx.$executeRawUnsafe(
                `SET SESSION sql_mode = REPLACE(REPLACE(@@sql_mode, 'NO_ZERO_DATE', ''), 'NO_ZERO_IN_DATE', '')`,
              );
              await tx.$executeRawUnsafe(createLike);
            });
            console.log(`  \x1b[32m+\x1b[0m ${table} (structure from ${REFERENCE_DB}, zero-dates allowed)`);
            created++;
            continue;
          } catch (retryErr) {
            failed.push({
              table,
              message: String(retryErr?.message ?? retryErr).split('\n').map((l) => l.trim()).filter(Boolean).slice(-1)[0],
            });
            continue;
          }
        }

        failed.push({ table, message: msg.split('\n').map((l) => l.trim()).filter(Boolean).slice(-1)[0] });
      }
    }

    const missing = await prisma.$queryRawUnsafe(
      `SELECT r.table_name AS t, r.column_name AS c, r.column_type AS ty,
              r.is_nullable AS nul, r.column_default AS def, r.column_comment AS cmt
         FROM information_schema.columns r
         LEFT JOIN information_schema.columns x
           ON x.table_schema = ? AND x.table_name = r.table_name AND x.column_name = r.column_name
        WHERE r.table_schema = ?
          AND x.column_name IS NULL
          AND r.table_name IN (
            SELECT table_name FROM information_schema.tables WHERE table_schema = ?
          )
        ORDER BY r.table_name, r.ordinal_position`,
      database,
      REFERENCE_DB,
      database,
    );

    for (const m of missing) {
      const table = m.t ?? m.table_name;
      const column = m.c ?? m.column_name;
      const type = m.ty ?? m.column_type;
      const nullable = (m.nul ?? m.is_nullable) === 'YES';
      const def = m.def ?? m.column_default;

      // NOT NULL without a default would fail on a non-empty table; leave such
      // columns nullable rather than inventing a value.
      const hasDefault = def !== null && def !== undefined && String(def).toUpperCase() !== 'NULL';
      const nullSql = nullable || !hasDefault ? 'NULL' : 'NOT NULL';

      // MySQL forbids DEFAULT on these types outright (error 1101), and rejects a
      // quoted default on TIME/DATE columns (error 1067).
      const noDefaultType = /^(tiny|medium|long)?(text|blob)|^json|^geometry/i.test(String(type));
      const defSql =
        !hasDefault || noDefaultType
          ? ''
          : ` DEFAULT ${/^[0-9.]+$/.test(String(def)) ? def : `'${String(def).replace(/'/g, "''")}'`}`;

      try {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${type} ${nullSql}${defSql}`,
        );
        console.log(`  \x1b[32m+\x1b[0m ${table}.${column} (from ${REFERENCE_DB})`);
        created++;
      } catch (err) {
        const detail = String(err?.message ?? err)
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(-2)
          .join(' | ');
        failed.push({ table: `${table}.${column}`, message: detail });
      }
    }
  }

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
