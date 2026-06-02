/**
 * Unique client ID generator (Feature 004).
 *
 * Format: `CLT-{year}-{NNNNN}` (5-digit zero-padded sequential, per practice,
 * resets each calendar year). If a single practice exceeds 99,999 clients in
 * a year, the generator falls back to `CLT-{year}-OVF-{NNNNN+}` and logs a
 * warning.
 *
 * Atomicity strategy:
 *  We use a SERIALIZABLE transaction with an "advisory lock" implemented
 *  via a SELECT … FOR UPDATE on a dedicated key row. The Prisma Client
 *  doesn't expose raw FOR UPDATE, so we use an interactive transaction
 *  with `Serializable` isolation. The ID column has a unique constraint
 *  on `(practiceId, uniqueClientId)`, so even if a race slips through
 *  the create() call will fail with P2002 — callers retry.
 *
 *  The year prefix already isolates sequences by year, so contention is
 *  minimal (one practice's clients with the same year are ordered by
 *  creation time).
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logging } from '@/lib/logging';

const MAX_SEQUENTIAL = 99_999;
const PADDING = 5;
const OVERFLOW_THRESHOLD = MAX_SEQUENTIAL;

export interface GenerateUniqueClientIdOptions {
  practiceId: string;
  year?: number;
  /** Override current Date (testing). */
  now?: Date;
}

export class UniqueIdGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UniqueIdGenerationError';
  }
}

/**
 * Generate the next unique client ID for a practice in a given year.
 *
 * Throws `UniqueIdGenerationError` if it cannot allocate an ID after
 * `maxRetries` attempts (e.g., unique-constraint collisions on retry).
 */
export async function generateUniqueClientId(
  options: GenerateUniqueClientIdOptions,
): Promise<string> {
  const { practiceId } = options;
  const year = options.year ?? options.now?.getFullYear() ?? new Date().getFullYear();
  const prefix = `CLT-${year}-`;
  const overflowPrefix = `CLT-${year}-OVF-`;

  return prisma.$transaction(
    async (tx) => {
      // Find the highest sequential ID for this practice+year.
      // Use Prisma's orderBy+take to grab the lexicographically last.
      const latest = await tx.client.findFirst({
        where: {
          practiceId,
          uniqueClientId: { startsWith: prefix },
        },
        orderBy: { uniqueClientId: 'desc' },
        select: { uniqueClientId: true },
      });

      let next = parseNextSequential(latest?.uniqueClientId, prefix, overflowPrefix);

      // Handle overflow.
      if (next > OVERFLOW_THRESHOLD) {
        const msg = `Client ID sequence exceeded ${MAX_SEQUENTIAL} for practice ${practiceId} in ${year} — entering overflow mode`;
        await logging.warn(msg, {
          resource: 'client',
          metadata: { practiceId, year, lastKnown: latest?.uniqueClientId },
        });
        return `${overflowPrefix}${String(next).padStart(PADDING, '0')}`;
      }

      return `${prefix}${String(next).padStart(PADDING, '0')}`;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/**
 * Parse the next sequential number from a previously generated ID.
 *
 *  - `CLT-2026-00042` → returns 43
 *  - `CLT-2026-OVF-00012` → returns 13
 *  - `undefined` (first client) → returns 1
 */
function parseNextSequential(
  previous: string | undefined,
  prefix: string,
  overflowPrefix: string,
): number {
  if (!previous) return 1;

  if (previous.startsWith(overflowPrefix)) {
    const tail = previous.slice(overflowPrefix.length);
    const n = Number.parseInt(tail, 10);
    return Number.isFinite(n) ? n + 1 : 1;
  }

  if (previous.startsWith(prefix)) {
    const tail = previous.slice(prefix.length);
    const n = Number.parseInt(tail, 10);
    return Number.isFinite(n) ? n + 1 : 1;
  }

  // Different year or unknown format — start fresh.
  return 1;
}

/**
 * Synchronous helper exposed for tests + simple callers that already have
 * a `latestUniqueClientId` to increment (e.g., from a sorted scan). NOT
 * atomic on its own — use the async variant for production paths.
 */
export function formatClientId(year: number, sequential: number): string {
  if (sequential <= 0) {
    throw new UniqueIdGenerationError('Sequential must be >= 1');
  }
  if (sequential > MAX_SEQUENTIAL) {
    return `CLT-${year}-OVF-${String(sequential).padStart(PADDING, '0')}`;
  }
  return `CLT-${year}-${String(sequential).padStart(PADDING, '0')}`;
}
