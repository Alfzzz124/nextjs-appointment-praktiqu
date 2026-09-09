/**
 * Read the id of the row just inserted, on the connection that inserted it.
 *
 * `LAST_INSERT_ID()` is scoped to the MySQL **connection**, and Prisma's
 * `$executeRawUnsafe` / `$queryRawUnsafe` are independent checkouts from the pool. So an
 * INSERT followed by a separate `prisma.$queryRawUnsafe('SELECT LAST_INSERT_ID()')` can
 * read a different connection and return `0`, or another concurrent request's id.
 *
 * Production runs with `connection_limit=1` per worker, which removes the
 * different-connection shape but not the hazard: with one shared connection, two
 * concurrent requests interleave — A inserts, B inserts, then A's SELECT returns B's id.
 *
 * The only safe form is one interactive transaction, which pins a single connection for
 * its whole body:
 *
 *     const id = await prisma.$transaction(async (tx) => {
 *       await tx.$executeRawUnsafe(`INSERT INTO … VALUES (?)`, value);
 *       return lastInsertId(tx);
 *     });
 *
 * Passing the pooled `prisma` client here type-checks — `PrismaClient` is structurally
 * assignable to `Prisma.TransactionClient` — so the compiler cannot enforce this. What
 * enforces it is `tests/unit/db/last-insert-id-pinning.test.ts`, which fails if any
 * statement in `src/` reads `LAST_INSERT_ID` off a bare `prisma.` client.
 *
 * Found 2026-08-30 during the service CRUD work; the last nine sites were converted
 * 2026-09-08.
 */
import type { Prisma } from '@prisma/client';

export async function lastInsertId(tx: Prisma.TransactionClient): Promise<bigint> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: bigint | number }>>(
    `SELECT LAST_INSERT_ID() AS id`,
  );
  if (rows.length === 0) throw new Error('LAST_INSERT_ID() returned no row');
  return BigInt(rows[0].id);
}

/** `lastInsertId` as a `number`, for the callers whose ids are API-facing integers. */
export async function lastInsertIdNumber(tx: Prisma.TransactionClient): Promise<number> {
  return Number(await lastInsertId(tx));
}
