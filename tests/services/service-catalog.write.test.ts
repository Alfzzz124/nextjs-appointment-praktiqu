/**
 * Service catalogue and mapping writes.
 *
 * Direct SQL on purpose: KiviCare's `kc_service_*` hooks only fire when `session_days`
 * is present, and we never send it. See services.write.ts for the full argument.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  kcService: { findFirst: vi.fn() },
  kcServiceDoctorMapping: { findFirst: vi.fn(), updateMany: vi.fn() },
  kcDoctorClinicMapping: { findMany: vi.fn() },
  $executeRawUnsafe: vi.fn(),
  $queryRawUnsafe: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

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
});

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
  it('inserts and returns the new id', async () => {
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
    const [sql, ...args] = db.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain('INSERT INTO wp_kc_services');
    expect(args).toEqual(['Terapi Keluarga', 'psychology_services', '{"id":7}', '400000', 1]);
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
    expect(args).toEqual([3n, 'Konseling', 8100001n]);
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
  });

  it('returns null on an empty doctor list without querying', async () => {
    expect(await findConflictingMapping({ doctorIds: [], clinicId: 3n, name: 'x' })).toBeNull();
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('insertMapping', () => {
  it('writes every column and returns the new id', async () => {
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
    const [sql, ...args] = db.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain('INSERT INTO wp_kc_service_doctor_mapping');
    expect(args).toEqual([101n, 8100001n, 3n, '250000', 60, 'no', 1, 1]);
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
    // 0 is CANCELLED — the count must exclude it, and the literal must not be inlined.
    expect(args).toEqual([101n, 8100001n, 0]);
  });

  it('reads an empty result as zero', async () => {
    db.$queryRawUnsafe.mockResolvedValue([]);
    expect(await countBlockingAppointments({ serviceId: 1n, doctorId: 2n })).toBe(0);
  });
});
