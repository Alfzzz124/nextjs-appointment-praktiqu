/**
 * GET /api/v1/public/professionals — the public directory, read from wp_users.
 *
 * Previously mocked `prisma.professional` and `prisma.professionalAvailability`, both
 * shadow tables. A professional is a `wp_users` row with the `kiviCare_doctor`
 * capability; their hours are `wp_kc_clinic_sessions`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/repositories/wp/doctors.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/doctors.repo')>()),
  listDoctors: vi.fn(),
}));
vi.mock('@/repositories/wp/clinic-sessions.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/clinic-sessions.repo')>()),
  listClinicSessions: vi.fn(),
}));

import { GET } from '@/app/api/v1/public/professionals/route';
import { listDoctors } from '@/repositories/wp/doctors.repo';
import { listClinicSessions } from '@/repositories/wp/clinic-sessions.repo';

const DOCTOR = 29;

function doctor(overrides: Record<string, unknown> = {}) {
  return {
    id: BigInt(DOCTOR),
    email: 'dr.a@test.local',
    displayName: 'Dr. A',
    firstName: 'Dewi',
    lastName: 'Santoso',
    description: 'Test bio',
    professionalType: 'PSIKOLOG_KLINIS',
    status: 'ACTIVE',
    specialties: ['Anxiety'],
    ...overrides,
  };
}

function makeReq(url: string) {
  return new Request(url) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listDoctors).mockResolvedValue({
    items: [doctor()] as never,
    total: 1,
    page: 1,
    perPage: 50,
  });
  vi.mocked(listClinicSessions).mockResolvedValue([]);
});

describe('GET /api/v1/public/professionals', () => {
  it('lists active professionals', async () => {
    const res = await GET(makeReq('http://localhost/api/v1/public/professionals'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(DOCTOR);
    expect(body.items[0].fullName).toBe('Dewi Santoso');
    expect(body.items[0].specialties).toEqual(['Anxiety']);

    // Only ACTIVE — a pending or deactivated professional is not bookable.
    expect(vi.mocked(listDoctors).mock.calls[0][0].statuses).toEqual(['ACTIVE']);
  });

  it('re-checks the specialty filter against the decoded list', async () => {
    // The repository filter is a LIKE over the whole basic_data blob, so it can match a
    // doctor whose blob merely mentions the word somewhere else.
    vi.mocked(listDoctors).mockResolvedValue({
      items: [doctor(), doctor({ id: 30n, specialties: ['Trauma'] })] as never,
      total: 2,
      page: 1,
      perPage: 50,
    });

    const res = await GET(
      makeReq('http://localhost/api/v1/public/professionals?specialty=Anxiety'),
    );

    const body = await res.json();
    expect(body.items.map((p: { id: number }) => p.id)).toEqual([DOCTOR]);
  });

  it('reports the next working day from the weekly schedule', async () => {
    vi.mocked(listClinicSessions).mockResolvedValue([
      { doctorId: BigInt(DOCTOR), day: 'mon', startTime: '13:00:00' },
      { doctorId: BigInt(DOCTOR), day: 'mon', startTime: '09:00:00' },
    ] as never);

    const body = await (await GET(makeReq('http://localhost/api/v1/public/professionals'))).json();

    // Earliest window on that day, not whichever row came back first.
    expect(body.items[0].nextAvailable.startTime).toBe('09:00:00');
    expect(new Date(`${body.items[0].nextAvailable.date}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('reports null rather than a fabricated time when there are no hours', async () => {
    const body = await (await GET(makeReq('http://localhost/api/v1/public/professionals'))).json();
    expect(body.items[0].nextAvailable).toBeNull();
  });

  it('rejects a non-numeric clinicId instead of querying NaN', async () => {
    const res = await GET(makeReq('http://localhost/api/v1/public/professionals?clinicId=abc'));
    expect(res.status).toBe(400);
    expect(listDoctors).not.toHaveBeenCalled();
  });
});
