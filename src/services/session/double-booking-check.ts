/**
 * Double-booking prevention for session creation.
 *
 * Source of truth: specs/005-session-mgmt/plan.md ("Double-Booking Prevention
 * Algorithm") and data-model.md ("Double-booking prevention" rule).
 *
 * Strategy:
 *   1. Open a Prisma transaction at SERIALIZABLE isolation.
 *   2. Verify the slot is not covered by any BOOKED / CHECK_IN / CHECK_OUT /
 *      COMPLETED session for the same professional on the same date.
 *   3. If clear, create the session row inside the same transaction.
 *   4. On conflict, throw `DoubleBookingError` so the route handler can
 *      surface a 409 response.
 *
 * Notes:
 *   - PENDING sessions do NOT block (FR-002). The first to be approved
 *     wins; subsequent approvals of conflicting PENDING sessions fail.
 *   - We use an overlap check: a session conflicts when
 *     existing.startTime < candidate.endTime
 *       AND existing.endTime > candidate.startTime.
 */

import { Prisma, SessionStatus } from '@prisma/client';
import { prisma } from '@/lib/db';

export class DoubleBookingError extends Error {
  readonly code = 'DOUBLE_BOOKING';
  constructor(message = 'This time slot is already booked for another session') {
    super(message);
    this.name = 'DoubleBookingError';
  }
}

export interface SlotCandidate {
  professionalId: string;
  serviceId: string;
  clientId: string;
  practiceId: string;
  slotDate: Date;
  startTime: Date;
  endTime: Date;
  createdBy: string;
}

const BLOCKING_STATUSES: SessionStatus[] = [
  SessionStatus.BOOKED,
  SessionStatus.CHECK_IN,
  SessionStatus.CHECK_OUT,
  SessionStatus.COMPLETED,
];

/**
 * Run the conflict check in a SERIALIZABLE transaction and return the created
 * session if no conflict exists. Throws `DoubleBookingError` otherwise.
 *
 * This is the only place in the codebase that creates a Session row directly
 * — callers MUST go through this helper to keep the integrity guarantee.
 */
export async function createSessionWithDoubleBookingGuard(
  data: SlotCandidate,
  tx?: Prisma.TransactionClient,
): Promise<{ id: string; startTime: Date; endTime: Date; status: SessionStatus }> {
  const runner = async (client: Prisma.TransactionClient) => {
    // Overlap: (existing.start < new.end) AND (existing.end > new.start)
    const conflict = await client.session.findFirst({
      where: {
        professionalId: data.professionalId,
        slotDate: data.slotDate,
        status: { in: BLOCKING_STATUSES },
        AND: [
          { startTime: { lt: data.endTime } },
          { endTime: { gt: data.startTime } },
        ],
      },
      select: { id: true, startTime: true, endTime: true, status: true },
    });

    if (conflict) {
      throw new DoubleBookingError();
    }

    const created = await client.session.create({
      data: {
        clientId: data.clientId,
        professionalId: data.professionalId,
        serviceId: data.serviceId,
        practiceId: data.practiceId,
        slotDate: data.slotDate,
        startTime: data.startTime,
        endTime: data.endTime,
        createdBy: data.createdBy,
        status: SessionStatus.PENDING,
      },
      select: { id: true, startTime: true, endTime: true, status: true },
    });

    return created;
  };

  if (tx) {
    return runner(tx);
  }

  // SERIALIZABLE is the strongest isolation level; on MySQL it requires
  // either explicit SET TRANSACTION ISOLATION LEVEL or InnoDB row-locking
  // semantics. We rely on the SELECT ... FOR UPDATE in the runner below.
  return prisma.$transaction(
    async (client) => {
      // Lock the index range for this professional+date so two parallel
      // requests cannot both pass the overlap check.
      await client.$queryRaw`
        SELECT id FROM sessions_booking
        WHERE professionalId = ${data.professionalId}
          AND slotDate = ${data.slotDate}
          AND status IN ('BOOKED','CHECK_IN','CHECK_OUT','COMPLETED')
        FOR UPDATE
      `;
      return runner(client);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10_000 },
  );
}

/**
 * Pure overlap check (used by tests and by other services that already
 * have an open transaction). Returns the conflicting session id or null.
 */
export async function findConflictingSession(
  professionalId: string,
  slotDate: Date,
  startTime: Date,
  endTime: Date,
  tx?: Prisma.TransactionClient,
): Promise<{ id: string; status: SessionStatus } | null> {
  const client = tx ?? prisma;
  const row = await client.session.findFirst({
    where: {
      professionalId,
      slotDate,
      status: { in: BLOCKING_STATUSES },
      AND: [
        { startTime: { lt: endTime } },
        { endTime: { gt: startTime } },
      ],
    },
    select: { id: true, status: true },
  });
  return row ? { id: row.id, status: row.status } : null;
}
