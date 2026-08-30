/**
 * Service catalogue and mapping writes.
 *
 * Direct SQL on purpose: KiviCare's `kc_service_*` hooks only fire when `session_days`
 * is present, and we never send it. See services.write.ts for the full argument.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => {
  const d: any = {
    kcService: { findFirst: vi.fn() },
    kcServiceDoctorMapping: { findFirst: vi.fn(), updateMany: vi.fn() },
    kcDoctorClinicMapping: { findMany: vi.fn() },
    $executeRawUnsafe: vi.fn(),
    $queryRawUnsafe: vi.fn(),
  };
  d.$transaction = vi.fn(async (fn: any) => fn(d));
  return d;
});
vi.mock('@/lib/db', () => ({ prisma: db }));

// APPOINTMENT_STATUS.CANCELLED really is 0, but the test must not pass just because the
// source and the test happen to agree on that literal. Mocking it to a sentinel that is
// NOT 0 means the assertion below only passes if the code actually imports and forwards
// this constant, rather than inlining a literal that happens to match.
//
// `vi.mock` factories are hoisted above all top-level `const`s, so the sentinel must be
// created inside `vi.hoisted` to be visible from the factory.
const CANCELLED_SENTINEL = vi.hoisted(() => 99);
vi.mock('@/repositories/wp/appointments.repo', () => ({
  APPOINTMENT_STATUS: { CANCELLED: CANCELLED_SENTINEL },
}));

import {
  findCatalogueByNameAndType,
  createCatalogue,
  doctorsMappedToClinic,
  findConflictingMapping,
  insertMapping,
  updateMapping,
  softDeleteMapping,
  countBlockingAppointments,
} from '@/repositories/wp/services.write';

beforeEach(() => {
  db.kcService.findFirst.mockReset();
  db.kcServiceDoctorMapping.findFirst.mockReset();
  db.kcServiceDoctorMapping.updateMany.mockReset();
  db.kcDoctorClinicMapping.findMany.mockReset();
  db.$executeRawUnsafe.mockReset();
  db.$queryRawUnsafe.mockReset();
  db.$transaction.mockClear();
});

/** Every raw query must bind exactly one argument per `?` placeholder in its SQL. */
function expectPlaceholdersMatchArgs(sql: string, args: unknown[]) {
  expect((sql.match(/\?/g) ?? []).length).toBe(args.length);
}

describe('findCatalogueByNameAndType', () => {
  it('matches on name and type together', async () => {
    db.kcService.findFirst.mockResolvedValue({ id: 101n });

    expect(await findCatalogueByNameAndType('Konseling', 'psychology_services')).toEqual({ id: 101n });
    expect(db.kcService.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'Konseling', type: 'psychology_services' } }),
    );
  });

  it('returns null when nothing matches', async () => {
    db.kcService.findFirst.mockResolvedValue(null);
    expect(await findCatalogueByNameAndType('Nope', 'x')).toBeNull();
  });
});

describe('createCatalogue', () => {
  it('inserts and returns the new id, on the same connection as the insert', async () => {
    db.$executeRawUnsafe.mockResolvedValue(1);
    db.$queryRawUnsafe.mockResolvedValue([{ id: 202 }]);

    const id = await createCatalogue({
      name: 'Terapi Keluarga',
      type: 'psychology_services',
      category: '{"id":7}',
      price: '400000',
      status: 1,
    });

    expect(id).toBe(202n);
    // The INSERT and the LAST_INSERT_ID() read must both run inside $transaction, so
    // they are pinned to the same pooled connection.
    expect(db.$transaction).toHaveBeenCalledTimes(1);

    const [sql, ...args] = db.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain('INSERT INTO wp_kc_services');
    expect(args).toEqual(['Terapi Keluarga', 'psychology_services', '{"id":7}', '400000', 1]);
    expectPlaceholdersMatchArgs(sql, args);
  });
});

describe('doctorsMappedToClinic', () => {
  it('returns only the doctors actually mapped to the clinic', async () => {
    db.kcDoctorClinicMapping.findMany.mockResolvedValue([{ doctorId: 1n }, { doctorId: 2n }]);

    expect(await doctorsMappedToClinic([1n, 2n, 3n], 3n)).toEqual([1n, 2n]);
    expect(db.kcDoctorClinicMapping.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clinicId: 3n, doctorId: { in: [1n, 2n, 3n] } } }),
    );
  });

  it('short-circuits on an empty list without querying', async () => {
    expect(await doctorsMappedToClinic([], 3n)).toEqual([]);
    expect(db.kcDoctorClinicMapping.findMany).not.toHaveBeenCalled();
  });
});

describe('findConflictingMapping', () => {
  it('finds an existing mapping for the same doctor, clinic and service name', async () => {
    db.$queryRawUnsafe.mockResolvedValue([{ mapping_id: 501, doctor_id: 8100001 }]);

    const hit = await findConflictingMapping({
      doctorIds: [8100001n],
      clinicId: 3n,
      name: 'Konseling',
    });

    expect(hit).toEqual({ mappingId: 501n, doctorId: 8100001n });
    const [sql, ...args] = db.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('wp_kc_service_doctor_mapping');
    expect(sql).toContain('JOIN wp_kc_services');
    expect(sql).toContain('s.name = ?');
    expect(args).toEqual([3n, 'Konseling', 8100001n]);
    expectPlaceholdersMatchArgs(sql, args);
  });

  it('excludes the row being edited when asked', async () => {
    db.$queryRawUnsafe.mockResolvedValue([]);

    await findConflictingMapping({
      doctorIds: [8100001n],
      clinicId: 3n,
      name: 'Konseling',
      excludeMappingId: 501n,
    });

    const [sql, ...args] = db.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('sdm.id <> ?');
    expect(args).toEqual([3n, 'Konseling', 8100001n, 501n]);
    expectPlaceholdersMatchArgs(sql, args);
  });

  it('builds one placeholder per doctor id, in order, for multiple doctors', async () => {
    db.$queryRawUnsafe.mockResolvedValue([]);

    await findConflictingMapping({
      doctorIds: [8100001n, 8100002n, 8100003n],
      clinicId: 3n,
      name: 'Konseling',
    });

    const [sql, ...args] = db.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('IN (?,?,?)');
    expect(args).toEqual([3n, 'Konseling', 8100001n, 8100002n, 8100003n]);
    expectPlaceholdersMatchArgs(sql, args);
  });

  it('returns null on an empty doctor list without querying', async () => {
    expect(await findConflictingMapping({ doctorIds: [], clinicId: 3n, name: 'x' })).toBeNull();
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('insertMapping', () => {
  it('writes every column and returns the new id, on the same connection as the insert', async () => {
    db.$executeRawUnsafe.mockResolvedValue(1);
    db.$queryRawUnsafe.mockResolvedValue([{ id: 777 }]);

    const id = await insertMapping({
      serviceId: 101n,
      doctorId: 8100001n,
      clinicId: 3n,
      charges: '250000',
      duration: 60,
      telemedService: 'no',
      status: 1,
      isPublic: 1,
    });

    expect(id).toBe(777n);
    expect(db.$transaction).toHaveBeenCalledTimes(1);

    const [sql, ...args] = db.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain('INSERT INTO wp_kc_service_doctor_mapping');
    expect(args).toEqual([101n, 8100001n, 3n, '250000', 60, 'no', 1, 1]);
    expectPlaceholdersMatchArgs(sql, args);
  });
});

describe('updateMapping', () => {
  it('only writes the columns present in the patch', async () => {
    db.$executeRawUnsafe.mockResolvedValue(1);

    await updateMapping(501n, { charges: '300000', status: 0 });

    const [sql, ...args] = db.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain('charges = ?');
    expect(sql).toContain('status = ?');
    expect(sql).not.toContain('duration = ?');
    expect(args).toEqual(['300000', 0, 501n]);
    expectPlaceholdersMatchArgs(sql, args);
  });

  it('does nothing at all for an empty patch', async () => {
    await updateMapping(501n, {});
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('can repoint the mapping to another catalogue row', async () => {
    db.$executeRawUnsafe.mockResolvedValue(1);

    await updateMapping(501n, { serviceId: 202n });

    const [sql, ...args] = db.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain('service_id = ?');
    expect(args).toEqual([202n, 501n]);
    expectPlaceholdersMatchArgs(sql, args);
  });
});

describe('softDeleteMapping', () => {
  it('sets status to 0 rather than deleting the row', async () => {
    db.$executeRawUnsafe.mockResolvedValue(1);

    expect(await softDeleteMapping(501n)).toBe(1);
    const [sql, ...args] = db.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain('SET status = 0');
    expect(sql).not.toContain('DELETE');
    expect(args).toEqual([501n]);
    expectPlaceholdersMatchArgs(sql, args);
  });
});

describe('countBlockingAppointments', () => {
  it('counts future, non-cancelled appointments for the service and doctor', async () => {
    db.$queryRawUnsafe.mockResolvedValue([{ c: 2n }]);

    const count = await countBlockingAppointments({ serviceId: 101n, doctorId: 8100001n });

    expect(count).toBe(2);
    const [sql, ...args] = db.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('wp_kc_appointment_service_mapping');
    expect(sql).toContain('a.appointment_start_date >= CURDATE()');
    // The mocked APPOINTMENT_STATUS.CANCELLED sentinel (99, not the real 0) must reach
    // the query args unchanged — this only passes if the code imports the constant
    // rather than inlining the literal `0`.
    expect(args).toEqual([101n, 8100001n, CANCELLED_SENTINEL]);
    expectPlaceholdersMatchArgs(sql, args);
  });

  it('reads an empty result as zero', async () => {
    db.$queryRawUnsafe.mockResolvedValue([]);
    expect(await countBlockingAppointments({ serviceId: 1n, doctorId: 2n })).toBe(0);
  });
});
