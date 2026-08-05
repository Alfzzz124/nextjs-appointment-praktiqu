/**
 * Timeline assembly from KiviCare appointments.
 *
 * Previously mocked `prisma.appointment` and three other shadow models, two of which
 * the service queried and then discarded.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/repositories/wp/sessions.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/sessions.repo')>()),
  listSessions: vi.fn(),
}));

import { ProgressService } from '@/services/progress/service';
import { listSessions } from '@/repositories/wp/sessions.repo';

const CLIENT = 461;

function session(id: number, slotDate: string | null, status = 'CHECK_IN') {
  return {
    id,
    clinicId: 3,
    professionalId: 29,
    clientId: CLIENT,
    professionalName: 'Dr. A',
    clientName: 'Jane Doe',
    clientEmail: 'jane@test.local',
    slotDate,
    startTime: '09:00:00',
    endTime: '10:00:00',
    timezone: 'Asia/Jakarta',
    status,
    serviceIds: [7],
    description: 'Sesi uji',
    createdAt: new Date('2025-12-01T00:00:00Z'),
  };
}

function respond(items: ReturnType<typeof session>[]) {
  vi.mocked(listSessions).mockResolvedValue({ items: items as never, total: items.length });
}

describe('ProgressService timeline', () => {
  let svc: ProgressService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new ProgressService({ goal: { findMany: vi.fn(), update: vi.fn() } } as never);
  });

  it('assembles sessions into timeline entries', async () => {
    respond([session(1, '2026-01-15')]);

    const timeline = await svc.getClientTimeline(CLIENT);

    expect(timeline).toHaveLength(1);
    expect(timeline[0].type).toBe('session');
    expect(timeline[0].clientId).toBe(CLIENT);
    expect(timeline[0].title).toBe('Session: CHECK_IN');
    expect(timeline[0].occurredAt.toISOString().slice(0, 10)).toBe('2026-01-15');
  });

  it('sorts by date descending', async () => {
    respond([session(1, '2026-01-01'), session(2, '2026-03-01')]);

    const timeline = await svc.getClientTimeline(CLIENT);
    expect(timeline.map((e) => e.id)).toEqual([2, 1]); // March before January
  });

  it('falls back to created_at when the row has no slot date', async () => {
    // A dateless row would otherwise land on an Invalid Date and break the sort.
    respond([session(1, null)]);

    const timeline = await svc.getClientTimeline(CLIENT);
    expect(timeline[0].occurredAt.toISOString()).toBe('2025-12-01T00:00:00.000Z');
  });
});
