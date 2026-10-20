/**
 * Vitest global setup: lift every wp_* AUTO_INCREMENT counter to ID_BLOCK_CEILING.
 *
 * Suites seed fixed ids inside their block (tests/helpers/id-blocks.ts), and MySQL moves
 * a table's counter to just past the highest id ever inserted. Rows the app inserts
 * during a test (a bill, a booking, a clinic created through the API) took the next
 * value: an id inside whichever suite held the highest block on that table, where that
 * suite's range cleanup would delete them. With the counter at the ceiling those rows
 * land above every block. A counter never moves down by itself, so after the first run
 * this only reads information_schema.
 *
 * Runs only against a test database (the same check as assertTestDb) and never fails
 * the run: without a reachable DB the integration suites fail on their own.
 */
import './setup-env';
import { PrismaClient } from '@prisma/client';
import { ID_BLOCK_CEILING } from './helpers/id-blocks';

export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  if (!/test/i.test(url)) return;

  // One connection, so the session settings below apply to the statements after them.
  const pinned = `${url}${url.includes('?') ? '&' : '?'}connection_limit=1`;
  const prisma = new PrismaClient({ datasources: { db: { url: pinned } } });
  const failed: string[] = [];
  try {
    // information_schema caches AUTO_INCREMENT for a day by default; read it live.
    await prisma.$executeRawUnsafe('SET SESSION information_schema_stats_expiry = 0');
    // WordPress tables declare '0000-00-00 00:00:00' defaults, which strict mode rejects
    // on any ALTER TABLE ("Invalid default value for 'date_ran'").
    await prisma.$executeRawUnsafe(`SET SESSION sql_mode = ''`);
    const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
         AND TABLE_NAME LIKE 'wp\\_%' AND AUTO_INCREMENT < ?`,
      ID_BLOCK_CEILING,
    );
    for (const { name } of tables) {
      try {
        await prisma.$executeRawUnsafe(`ALTER TABLE \`${name}\` AUTO_INCREMENT = ${ID_BLOCK_CEILING}`);
      } catch (err: any) {
        failed.push(`${name} (${err?.meta?.message ?? err?.message})`);
      }
    }
  } catch (err: any) {
    failed.push(String(err?.meta?.message ?? err?.message ?? err).trim());
  } finally {
    if (failed.length) {
      console.warn(`[global-setup] AUTO_INCREMENT not lifted for: ${failed.join('; ')}`);
    }
    await prisma.$disconnect();
  }
}
