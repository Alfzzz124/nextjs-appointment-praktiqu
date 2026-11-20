/**
 * GET /sessions dan GET /sessions/{id} membawa `meetingUrl` dari baris sinkronisasi
 * Google janji itu, null bila tidak ada. Daftar mengambilnya sekali per halaman.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_STATUS, type SessionRow } from '@/repositories/wp/sessions.repo';

const repo = vi.hoisted(() => ({ findSessionById: vi.fn(), listSessions: vi.fn() }));
vi.mock('@/repositories/wp/sessions.repo', async (orig) => ({
  ...(await orig<typeof import('@/repositories/wp/sessions.repo')>()),
  findSessionById: (...a: unknown[]) => repo.findSessionById(...a),
  listSessions: (...a: unknown[]) => repo.listSessions(...a),
}));

const kcActor = vi.hoisted(() => ({ resolveKcActor: vi.fn() }));
vi.mock('@/services/billing/kc-actor', () => kcActor);

const views = vi.hoisted(() => ({ withApprovals: vi.fn() }));
vi.mock('@/services/approval/service', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/service')>()),
  withApprovals: (...a: unknown[]) => views.withApprovals(...a),
}));

const sync = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { googleCalendarEventSync: { findMany: sync.findMany } } }));

vi.mock('@/lib/logging', () => ({
  logging: { audit: vi.fn(), warn: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn() },
}));

import { getSession, listSessions } from '@/services/session/session.service';

function row(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 7,
    clinicId: 1,
    professionalId: 119,
    clientId: 522,
    professionalName: 'Pamela Dewi',
    clientName: 'Ada Lovelace',
    clientEmail: 'ada@contoh.test',
    professionalEmail: 'pamela@klinik.test',
    slotDate: '2099-09-10',
    startTime: '09:30:00',
    endTime: '10:30:00',
    timezone: 'Asia/Jakarta',
    status: SESSION_STATUS.BOOKED,
    serviceIds: [3],
    description: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
  };
}

const ADMIN = { id: 'u_admin', role: 'SUPER_ADMIN', practiceId: null };
const MEET = 'https://meet.google.com/abc-defg-hij';

beforeEach(() => {
  vi.clearAllMocks();
  kcActor.resolveKcActor.mockResolvedValue({ actor: ADMIN, wpUserId: 1n, clinicId: 1n });
  views.withApprovals.mockImplementation(async (rows: unknown[]) =>
    (rows as object[]).map((r) => ({ ...r, approval: null })),
  );
  sync.findMany.mockResolvedValue([]);
});

describe('listSessions — meetingUrl', () => {
  it('memberi tiap item tautan dari baris sinkronisasinya, dan null bila tak ada', async () => {
    repo.listSessions.mockResolvedValue({ items: [row({ id: 7 }), row({ id: 8 })], total: 2 });
    sync.findMany.mockResolvedValue([{ appointmentId: 7n, hangoutLink: MEET }]);

    const res = await listSessions(ADMIN as never, {});

    expect(res.data.map((s) => [s.id, s.meetingUrl])).toEqual([
      [7, MEET],
      [8, null],
    ]);
    expect(sync.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('getSession — meetingUrl', () => {
  it('membawa tautan dari baris sinkronisasi', async () => {
    repo.findSessionById.mockResolvedValue(row());
    sync.findMany.mockResolvedValue([{ appointmentId: 7n, hangoutLink: MEET }]);

    expect((await getSession(ADMIN as never, 7)).meetingUrl).toBe(MEET);
  });

  it('null tanpa baris sinkronisasi', async () => {
    repo.findSessionById.mockResolvedValue(row());

    expect((await getSession(ADMIN as never, 7)).meetingUrl).toBeNull();
  });
});
