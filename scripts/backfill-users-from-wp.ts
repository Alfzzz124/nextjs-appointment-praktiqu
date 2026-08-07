#!/usr/bin/env tsx
/**
 * Backfill `users` rows for WordPress accounts that never got one.
 *
 * A `users` row appears only when someone logs into the app. WordPress accounts come from
 * elsewhere too — every guest booking creates a patient — so people end up with a real
 * account and no app row. On staging that was 789 of 850.
 *
 * All the decisions live in `src/lib/auth/wp-backfill.ts` and are unit-tested. This file
 * is the IO around them: read, plan, print, and only write when told to.
 *
 *   npx tsx scripts/backfill-users-from-wp.ts            # dry run — prints the plan
 *   npx tsx scripts/backfill-users-from-wp.ts --apply    # writes
 *
 * Idempotent: rows already linked by `wpUserId` are never selected, so re-running after a
 * partial run picks up exactly what is left.
 */

import { prisma } from '../src/lib/db';
import { planBackfill, type WpUserRow } from '../src/lib/auth/wp-backfill';

const APPLY = process.argv.includes('--apply');

interface RawRow {
  id: bigint | number;
  email: string | null;
  login: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  capabilities: string | null;
  clientStatus: string | null;
}

async function main() {
  const raw = await prisma.$queryRawUnsafe<RawRow[]>(`
    SELECT u.ID              AS id,
           u.user_email      AS email,
           u.user_login      AS login,
           u.display_name    AS displayName,
           COALESCE(fn.meta_value, '') AS firstName,
           COALESCE(ln.meta_value, '') AS lastName,
           COALESCE(cap.meta_value, '') AS capabilities,
           cs.meta_value     AS clientStatus
    FROM wp_users u
    LEFT JOIN users a       ON a.wpUserId = u.ID
    LEFT JOIN wp_usermeta fn  ON fn.user_id = u.ID AND fn.meta_key = 'first_name'
    LEFT JOIN wp_usermeta ln  ON ln.user_id = u.ID AND ln.meta_key = 'last_name'
    LEFT JOIN wp_usermeta cap ON cap.user_id = u.ID AND cap.meta_key = 'wp_capabilities'
    LEFT JOIN wp_usermeta cs  ON cs.user_id = u.ID AND cs.meta_key = 'praktiqu_client_status'
    WHERE a.id IS NULL
    ORDER BY u.ID
  `);

  const rows: WpUserRow[] = raw.map((r) => ({
    id: Number(r.id),
    email: r.email ?? '',
    login: r.login ?? '',
    displayName: r.displayName ?? '',
    firstName: r.firstName ?? '',
    lastName: r.lastName ?? '',
    capabilities: r.capabilities ?? '',
    clientStatus: r.clientStatus,
  }));

  const existing = await prisma.user.findMany({ select: { email: true, username: true } });
  const taken = {
    emails: new Set(existing.map((u) => u.email.toLowerCase())),
    usernames: new Set(existing.map((u) => u.username)),
  };

  const { insert, skip } = planBackfill(rows, taken);

  const byRole = insert.reduce<Record<string, number>>((acc, u) => {
    acc[u.role] = (acc[u.role] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`WordPress accounts without an app row : ${rows.length}`);
  console.log(`  to insert                           : ${insert.length}`);
  for (const [role, n] of Object.entries(byRole).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${role.padEnd(14)} ${n}`);
  }
  console.log(`  to skip                             : ${skip.length}`);
  for (const s of skip) console.log(`      wp#${s.id} ${s.email || '(no email)'} — ${s.reason}`);

  const renamed = insert.filter((u) => u.username.includes('_') && /_\d+$/.test(u.username));
  if (renamed.length) {
    console.log(`  logins made unique                  : ${renamed.length}`);
    for (const u of renamed) console.log(`      wp#${u.wpUserId} -> ${u.username}`);
  }

  if (!APPLY) {
    console.log('\nDry run. Nothing written. Re-run with --apply to write.');
    return;
  }

  // createMany fills in the cuid default per row and is a single statement, so a failure
  // leaves nothing behind rather than a partial batch.
  const result = await prisma.user.createMany({ data: insert, skipDuplicates: true });
  console.log(`\nInserted ${result.count} rows.`);

  const after = await prisma.user.count();
  console.log(`users now holds ${after} rows.`);
}

main()
  .catch((err) => {
    console.error('backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
