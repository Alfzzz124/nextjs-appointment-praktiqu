/**
 * Professional domain against WordPress tables.
 *
 * Replaces three mock-based suites that stubbed `prisma.professional`,
 * `prisma.professionalAvailability` and `prisma.professionalServiceAssignment` — models
 * that no longer exist. Those mocks described a schema, not behaviour, so porting them
 * would have preserved nothing worth keeping.
 *
 * Runs against the real test database. Only the plugin write path is mocked, because
 * there is no WordPress here.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';

/** Stand in for the praktiqu-endpoint plugin's doctor write endpoints. */
vi.mock('@/repositories/wp/doctors.write', () => ({
  createDoctor: vi.fn(async () => {
    throw new Error('createDoctor is not exercised by this suite');
  }),
  updateDoctor: vi.fn(async (id: number, input: Record<string, unknown>) => {
    const { prisma: db } = await import('@/lib/db');
    // Only the status path is exercised here; it is what the service actually writes.
    if (typeof input.status === 'string') {
      await db.$executeRawUnsafe(
        `DELETE FROM wp_usermeta WHERE user_id = ? AND meta_key = 'praktiqu_professional_status'`,
        id,
      );
      await db.$executeRawUnsafe(
        `INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES (?, 'praktiqu_professional_status', ?)`,
        id,
        input.status,
      );
    }
    return { id, email: '', firstName: '', lastName: '', registrationNumber: null, professionalType: null, status: null };
  }),
}));

const { PROFESSIONAL_STATUS, getProfessional, listProfessionals, setProfessionalStatus } =
  await import('@/services/professional/professional.service');
const { getWeeklySchedule, setWeeklySchedule, addOffDay, listOffDays, removeOffDay, generateSlots } =
  await import('@/services/professional/availability.service');
const { listAssignedServices, assignService, unassignService } =
  await import('@/services/professional/service-assignment.service');

const BASE = 8_100_000;
const END = BASE + 100_000;
const DOCTOR = BASE + 1;
const CLINIC = BASE + 10;
const SERVICE = BASE + 20;

function capabilities(role: string): string {
  return `a:1:{s:${role.length}:"${role}";b:1;}`;
}

async function wipe() {
  for (const [table, col] of [
    ['wp_kc_clinic_sessions', 'doctor_id'],
    ['wp_kc_clinic_schedule', 'module_id'],
    ['wp_kc_service_doctor_mapping', 'doctor_id'],
    ['wp_kc_doctor_clinic_mappings', 'doctor_id'],
    ['wp_kc_appointments', 'doctor_id'],
  ] as const) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM ${table} WHERE ${col} >= ? AND ${col} < ?`,
      BASE,
      END,
    );
  }
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_services WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();

  await prisma.kcUser.create({
    data: {
      id: BigInt(DOCTOR),
      userLogin: `dr${DOCTOR}`,
      userEmail: `dr${DOCTOR}@test.local`,
      displayName: 'Dr Uji Coba',
      userRegistered: new Date('2026-01-01T00:00:00Z'),
    },
  });
  await prisma.kcUserMeta.createMany({
    data: [
      { userId: BigInt(DOCTOR), metaKey: 'wp_capabilities', metaValue: capabilities('kiviCare_doctor') },
      { userId: BigInt(DOCTOR), metaKey: 'first_name', metaValue: 'Uji' },
      { userId: BigInt(DOCTOR), metaKey: 'last_name', metaValue: 'Coba' },
      { userId: BigInt(DOCTOR), metaKey: 'praktiqu_professional_type', metaValue: 'PSIKOLOG_KLINIS' },
      { userId: BigInt(DOCTOR), metaKey: 'praktiqu_registration_number', metaValue: 'PSI-12345-2024' },
      { userId: BigInt(DOCTOR), metaKey: 'praktiqu_professional_status', metaValue: 'ACTIVE' },
    ],
  });
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_doctor_clinic_mappings (doctor_id, clinic_id, created_at) VALUES (?, ?, NOW())`,
    DOCTOR,
    CLINIC,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_services (id, name, type, price, status, created_at) VALUES (?, 'Konseling', 'system_service', '250000', 1, NOW())`,
    SERVICE,
  );
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('professional service', () => {
  it('reads a professional from wp_users with its praktiqu_* attributes', async () => {
    const p = await getProfessional(DOCTOR);

    expect(p).not.toBeNull();
    expect(p!.fullName).toBe('Uji Coba');
    expect(p!.professionalType).toBe('PSIKOLOG_KLINIS');
    expect(p!.registrationNumber).toBe('PSI-12345-2024');
    expect(p!.status).toBe(PROFESSIONAL_STATUS.ACTIVE);
  });

  it('scopes the list to the actor’s clinic', async () => {
    const mine = await listProfessionals({ page: 1, pageSize: 50 }, CLINIC);
    expect(mine.data.map((p) => p.id)).toContain(DOCTOR);

    const other = await listProfessionals({ page: 1, pageSize: 50 }, CLINIC + 999);
    expect(other.data.map((p) => p.id)).not.toContain(DOCTOR);
  });

  it('changes status through the plugin write path', async () => {
    await setProfessionalStatus(DOCTOR, PROFESSIONAL_STATUS.INACTIVE, 'actor-1');
    expect((await getProfessional(DOCTOR))!.status).toBe(PROFESSIONAL_STATUS.INACTIVE);

    await setProfessionalStatus(DOCTOR, PROFESSIONAL_STATUS.ACTIVE, 'actor-1');
    expect((await getProfessional(DOCTOR))!.status).toBe(PROFESSIONAL_STATUS.ACTIVE);
  });
});

describe('availability', () => {
  it('replaces the weekly schedule and reads it back', async () => {
    await setWeeklySchedule(DOCTOR, CLINIC, [
      { day: 'mon', startTime: '09:00:00', endTime: '12:00:00', slotDurationMinutes: 60 },
      { day: 'mon', startTime: '13:00:00', endTime: '17:00:00', slotDurationMinutes: 60 },
      { day: 'wed', startTime: '09:00:00', endTime: '11:00:00', slotDurationMinutes: 30 },
    ]);

    const week = await getWeeklySchedule(DOCTOR, CLINIC);
    expect(week.mon).toHaveLength(2);
    expect(week.mon.map((w) => w.startTime)).toEqual(['09:00:00', '13:00:00']);
    expect(week.wed[0].slotDurationMinutes).toBe(30);
    expect(week.tue).toEqual([]);
  });

  it('rejects windows that overlap on the same day', async () => {
    // Two overlapping rows would make the same minute bookable twice.
    await expect(
      setWeeklySchedule(DOCTOR, CLINIC, [
        { day: 'thu', startTime: '09:00:00', endTime: '12:00:00', slotDurationMinutes: 60 },
        { day: 'thu', startTime: '11:00:00', endTime: '14:00:00', slotDurationMinutes: 60 },
      ]),
    ).rejects.toMatchObject({ _tag: 'conflict' });
  });

  it('adds, lists and removes an off day', async () => {
    const id = await addOffDay(DOCTOR, { startDate: '2026-09-07', endDate: '2026-09-07' });

    expect((await listOffDays(DOCTOR)).map((o) => o.id)).toContain(id);
    await removeOffDay(DOCTOR, id);
    expect((await listOffDays(DOCTOR)).map((o) => o.id)).not.toContain(id);
  });

  it('refuses a time-specific off day without both times', async () => {
    await expect(
      addOffDay(DOCTOR, { startDate: '2026-09-08', timeSpecific: true }),
    ).rejects.toMatchObject({ _tag: 'validation' });
  });
});

describe('slot generation', () => {
  beforeAll(async () => {
    await setWeeklySchedule(DOCTOR, CLINIC, [
      { day: 'mon', startTime: '09:00:00', endTime: '12:00:00', slotDurationMinutes: 60 },
    ]);
    await assignService(DOCTOR, SERVICE, CLINIC, 'actor-1', { durationMinutes: 60 });
  });

  // 2026-09-07 is a Monday.
  const MONDAY = '2026-09-07';

  it('generates slots across the window', async () => {
    const slots = await generateSlots(DOCTOR, MONDAY, SERVICE, CLINIC);
    expect(slots.map((s) => s.startTime)).toEqual(['09:00:00', '10:00:00', '11:00:00']);
  });

  it('returns nothing on a full-day off day', async () => {
    const id = await addOffDay(DOCTOR, { startDate: MONDAY, endDate: MONDAY });
    expect(await generateSlots(DOCTOR, MONDAY, SERVICE, CLINIC)).toEqual([]);
    await removeOffDay(DOCTOR, id);
  });

  it('drops only the covered slots for a time-specific off day', async () => {
    // The regression this guards: the previous implementation returned [] for ANY
    // matching off day, so a partial closure hid the whole morning.
    const id = await addOffDay(DOCTOR, {
      startDate: MONDAY,
      endDate: MONDAY,
      timeSpecific: true,
      startTime: '10:00:00',
      endTime: '11:00:00',
    });

    const slots = await generateSlots(DOCTOR, MONDAY, SERVICE, CLINIC);
    expect(slots.map((s) => s.startTime)).toEqual(['09:00:00', '11:00:00']);

    await removeOffDay(DOCTOR, id);
  });

  it('excludes slots taken by an active appointment', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_appointments
         (id, clinic_id, doctor_id, patient_id, appointment_start_date, appointment_start_time,
          appointment_end_date, appointment_end_time, appointment_timezone, visit_type, status, created_at)
       VALUES (?, ?, ?, ?, ?, '09:00:00', ?, '10:00:00', 'Asia/Jakarta', 'in_clinic', 1, NOW())`,
      BASE + 5000,
      CLINIC,
      DOCTOR,
      BASE + 900,
      MONDAY,
      MONDAY,
    );

    const slots = await generateSlots(DOCTOR, MONDAY, SERVICE, CLINIC);
    expect(slots.map((s) => s.startTime)).toEqual(['10:00:00', '11:00:00']);

    await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_appointments WHERE id = ?`, BASE + 5000);
  });

  it('returns nothing for an inactive professional', async () => {
    await setProfessionalStatus(DOCTOR, PROFESSIONAL_STATUS.INACTIVE, 'actor-1');
    expect(await generateSlots(DOCTOR, MONDAY, SERVICE, CLINIC)).toEqual([]);
    await setProfessionalStatus(DOCTOR, PROFESSIONAL_STATUS.ACTIVE, 'actor-1');
  });
});

describe('service assignments', () => {
  it('assigns, lists and soft-unassigns', async () => {
    await assignService(DOCTOR, SERVICE, CLINIC, 'actor-1', { charges: '300000' });

    const assigned = await listAssignedServices(DOCTOR, CLINIC);
    expect(assigned.map((a) => a.serviceId)).toContain(SERVICE);
    expect(assigned.find((a) => a.serviceId === SERVICE)!.charges).toBe('300000');

    await unassignService(DOCTOR, SERVICE, 'actor-1', CLINIC);
    expect((await listAssignedServices(DOCTOR, CLINIC)).map((a) => a.serviceId)).not.toContain(SERVICE);
  });

  it('re-assigning reactivates rather than duplicating', async () => {
    // The mapping table has no unique constraint, and unassign is a soft status flip,
    // so a blind insert would leave two rows for the same pairing.
    await assignService(DOCTOR, SERVICE, CLINIC, 'actor-1');
    await unassignService(DOCTOR, SERVICE, 'actor-1', CLINIC);
    await assignService(DOCTOR, SERVICE, CLINIC, 'actor-1');

    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*) AS n FROM wp_kc_service_doctor_mapping WHERE doctor_id = ? AND service_id = ?`,
      DOCTOR,
      SERVICE,
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it('refuses to assign an inactive service', async () => {
    await prisma.$executeRawUnsafe(`UPDATE wp_kc_services SET status = 0 WHERE id = ?`, SERVICE);

    await expect(assignService(DOCTOR, SERVICE, CLINIC, 'actor-1')).rejects.toMatchObject({
      _tag: 'validation',
    });

    await prisma.$executeRawUnsafe(`UPDATE wp_kc_services SET status = 1 WHERE id = ?`, SERVICE);
  });
});
