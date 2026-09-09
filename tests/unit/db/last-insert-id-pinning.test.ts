/**
 * `SELECT LAST_INSERT_ID()` must run on the same connection as its INSERT.
 *
 * MySQL scopes `LAST_INSERT_ID()` to the connection. Prisma's `$executeRawUnsafe` and
 * `$queryRawUnsafe` are independent checkouts from the pool, so an INSERT followed by a
 * *separate* `prisma.$queryRawUnsafe('SELECT LAST_INSERT_ID()')` can read a different
 * connection and return `0`, or another concurrent request's insert id. Production runs
 * with `connection_limit=1` per worker, which removes the stale-connection shape but
 * leaves interleaving between two concurrent requests on the shared connection: request A
 * inserts, request B inserts, then A's SELECT returns B's id.
 *
 * The fix is one interactive transaction, which pins a single connection for its whole
 * body. This file guards that in two ways:
 *
 *   1. A codebase invariant — no `LAST_INSERT_ID` anywhere in `src/` may be issued on a
 *      bare `prisma.` client. That covers every current site and every future one, which
 *      a per-site behavioural test cannot.
 *   2. Behavioural checks on representative callers, with `$transaction` handing the
 *      callback a *distinct* `tx` spy. This is the part a naive mock gets wrong: a
 *      `$transaction` stub shaped `async (fn) => fn(prisma)` hands back the same object,
 *      so it proves a transaction was opened but never that the statements ran on `tx`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* ------------------------------------------------------------------ */
/* 1. Codebase invariant                                               */
/* ------------------------------------------------------------------ */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * Strip comments before scanning. `src/lib/last-insert-id.ts` documents the hazard by
 * quoting the *wrong* form in its docblock, and an early version of this test flagged
 * that prose as an offender. Prose that teaches the rule must not trip it.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Collapse a file to single logical statements so a call split across lines is still
 * matched. Several real sites were written as:
 *
 *     const rows = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(
 *       `SELECT LAST_INSERT_ID() AS id`,
 *     );
 *
 * A line-based grep misses those, which is exactly how two of them survived an audit.
 */
function statements(source: string): string[] {
  return stripComments(source)
    .replace(/\s+/g, ' ')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

describe('LAST_INSERT_ID is never issued on a pooled client', () => {
  it('finds no bare prisma.$queryRawUnsafe carrying LAST_INSERT_ID in src/', () => {
    const offenders: string[] = [];

    for (const file of walk('src')) {
      for (const stmt of statements(readFileSync(file, 'utf8'))) {
        if (!stmt.includes('LAST_INSERT_ID')) continue;
        // `tx.$queryRawUnsafe(...)` is the correct form. Anything reaching for the
        // module-level `prisma` client in the same statement is the bug.
        if (/\bprisma\s*\.\s*\$queryRawUnsafe/.test(stmt)) {
          offenders.push(file);
          break;
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('still sees the correct tx-pinned form, so the invariant test is not vacuous', () => {
    // If a refactor ever removed every LAST_INSERT_ID read, the test above would pass for
    // the wrong reason. Pin that at least one correct site exists.
    const pinned = walk('src').filter((file) =>
      statements(readFileSync(file, 'utf8')).some(
        (s) => s.includes('LAST_INSERT_ID') && /\btx\s*\.\s*\$queryRawUnsafe/.test(s),
      ),
    );

    expect(pinned.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Behavioural checks on representative callers                     */
/* ------------------------------------------------------------------ */

const tx = vi.hoisted(() => ({
  $executeRawUnsafe: vi.fn(),
  $queryRawUnsafe: vi.fn(),
}));

const db = vi.hoisted(() => ({
  prisma: {
    // Deliberately hands the callback a DISTINCT object. A stub that passed `prisma`
    // itself would let the buggy code pass this file.
    $transaction: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $queryRawUnsafe: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => db);

beforeEach(() => {
  tx.$executeRawUnsafe.mockReset().mockResolvedValue(1);
  tx.$queryRawUnsafe.mockReset().mockResolvedValue([{ id: 4242 }]);
  db.prisma.$executeRawUnsafe.mockReset().mockResolvedValue(1);
  db.prisma.$queryRawUnsafe.mockReset().mockResolvedValue([{ id: 9999 }]);
  db.prisma.$transaction.mockReset().mockImplementation(async (fn: (c: unknown) => unknown) => fn(tx));
});

/** The id every caller must return is the one read inside the transaction. */
const TX_ID = 4242;

/** Every LAST_INSERT_ID read must have landed on `tx`, never on the pooled client. */
function expectPinned() {
  const onTx = tx.$queryRawUnsafe.mock.calls.filter((c) => String(c[0]).includes('LAST_INSERT_ID'));
  const onPool = db.prisma.$queryRawUnsafe.mock.calls.filter((c) =>
    String(c[0]).includes('LAST_INSERT_ID'),
  );

  expect(db.prisma.$transaction).toHaveBeenCalled();
  expect(onTx.length).toBeGreaterThan(0);
  expect(onPool).toEqual([]);
}

describe('createRating', () => {
  it('reads its new id inside the transaction that inserted', async () => {
    const { createRating } = await import('@/services/billing/rating.service');

    const res = await createRating(
      { doctorId: 119, patientId: 522, review: 5 },
      { actor: { id: 'wpu_1', role: 'CLINIC_ADMIN' }, wpUserId: 1n, clinicId: 1n } as never,
    );

    expect(res.id).toBe(TX_ID);
    expectPinned();
  });
});

describe('createConsentVersion', () => {
  it('reads its new id inside the transaction that inserted', async () => {
    // The version number is derived from MAX(version_number) — that read belongs in the
    // same transaction, or two concurrent creates can compute the same number.
    tx.$queryRawUnsafe.mockImplementation(async (sql: string) =>
      sql.includes('LAST_INSERT_ID') ? [{ id: TX_ID }] : [{ mx: 3 }],
    );
    const { createConsentVersion } = await import('@/services/billing/gdpr.service');

    const res = await createConsentVersion(
      { consentType: 'tos', title: 'T', bodyText: 'B', legalBasis: 'consent' } as never,
      { actor: { id: 'wpu_1', role: 'SUPER_ADMIN' }, wpUserId: 1n, clinicId: null } as never,
    );

    expect(res.id).toBe(TX_ID);
    expectPinned();
  });
});

describe('grantConsent', () => {
  it('reads its new id inside the transaction that inserted', async () => {
    const { grantConsent } = await import('@/services/billing/gdpr.service');

    const res = await grantConsent(
      { userId: 522, consentType: 'tos', consentVersionId: '7' },
      { actor: { id: 'wpu_1', role: 'CLINIC_ADMIN' }, wpUserId: 1n, clinicId: 1n } as never,
      '127.0.0.1',
    );

    expect(res.id).toBe(TX_ID);
    expectPinned();
  });
});

describe('createOffDay', () => {
  it('reads its new id inside the transaction that inserted', async () => {
    const { createOffDay } = await import('@/repositories/wp/off-days.repo');

    const id = await createOffDay({
      moduleType: 'doctor',
      moduleId: 119,
      startDate: '2026-10-01',
    } as never);

    expect(id).toBe(BigInt(TX_ID));
    expectPinned();
  });
});
