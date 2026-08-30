import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({ listClinicServices: vi.fn(), findMappingById: vi.fn() }));
vi.mock('@/repositories/wp/services.repo', () => repo);

const write = vi.hoisted(() => ({
  findCatalogueByNameAndType: vi.fn(),
  createCatalogue: vi.fn(),
  doctorsMappedToClinic: vi.fn(),
  findConflictingMapping: vi.fn(),
  insertMapping: vi.fn(),
  updateMapping: vi.fn(),
  softDeleteMapping: vi.fn(),
  countBlockingAppointments: vi.fn(),
}));
vi.mock('@/repositories/wp/services.write', () => write);

const staticData = vi.hoisted(() => ({ findServiceTypeById: vi.fn() }));
vi.mock('@/repositories/wp/static-data.repo', () => staticData);

const logging = vi.hoisted(() => ({ audit: vi.fn() }));
vi.mock('@/lib/logging', () => logging);

import { deleteService } from '@/services/service-catalog/service';
import type { ServiceScope } from '@/services/service-catalog/scope';

const row = {
  id: 501n,
  serviceId: 101n,
  doctorId: 8100001n,
  clinicId: 3n,
  name: 'Konseling Individu',
  type: 'psychology_services',
  category: null,
  charges: '250000',
  durationMinutes: 60,
  telemedService: 'no',
  isPublic: true,
  isActive: true,
  nameAlias: null,
  createdAt: new Date('2026-05-01T00:00:00Z'),
};

const clinicAdmin: ServiceScope = { clinicId: 3n, doctorId: null, empty: false };
const otherClinic: ServiceScope = { clinicId: 9n, doctorId: null, empty: false };

beforeEach(() => {
  Object.values(write).forEach((f) => f.mockReset());
  repo.findMappingById.mockReset();
  logging.audit.mockReset();

  repo.findMappingById.mockResolvedValue(row);
  write.countBlockingAppointments.mockResolvedValue(0);
  write.softDeleteMapping.mockResolvedValue(1);
});

const expectError = async (fn: () => Promise<unknown>, tag: string) => {
  await expect(fn()).rejects.toMatchObject({ _tag: tag });
};

describe('deleteService', () => {
  it('soft-deletes when nothing upcoming uses the service', async () => {
    expect(await deleteService(501, clinicAdmin, 'actor-1')).toEqual({ ok: true });
    expect(write.softDeleteMapping).toHaveBeenCalledWith(501n);
  });

  it('checks the catalogue service id against this mapping’s doctor', async () => {
    await deleteService(501, clinicAdmin, 'actor-1');

    expect(write.countBlockingAppointments).toHaveBeenCalledWith({
      serviceId: 101n,
      doctorId: 8100001n,
    });
  });

  it('refuses with a conflict when upcoming appointments exist, and reports how many', async () => {
    write.countBlockingAppointments.mockResolvedValue(3);

    await expect(deleteService(501, clinicAdmin, 'actor-1')).rejects.toMatchObject({
      _tag: 'conflict',
      count: 3,
    });
    expect(write.softDeleteMapping).not.toHaveBeenCalled();
  });

  it('404s a mapping in another clinic', async () => {
    await expectError(() => deleteService(501, otherClinic, 'actor-1'), 'not_found');
    expect(write.countBlockingAppointments).not.toHaveBeenCalled();
  });

  it('404s a mapping that does not exist', async () => {
    repo.findMappingById.mockResolvedValue(null);

    await expectError(() => deleteService(501, clinicAdmin, 'actor-1'), 'not_found');
  });

  it('audits the deletion', async () => {
    await deleteService(501, clinicAdmin, 'actor-1');

    expect(logging.audit).toHaveBeenCalledWith(
      'service.deleted',
      expect.objectContaining({ userId: 'actor-1', resource: 'service', resourceId: '501' }),
    );
  });

  it('is idempotent for a mapping already retired: no re-check, no re-write, no second audit', async () => {
    repo.findMappingById.mockResolvedValue({ ...row, isActive: false });

    expect(await deleteService(501, clinicAdmin, 'actor-1')).toEqual({ ok: true });
    expect(write.countBlockingAppointments).not.toHaveBeenCalled();
    expect(write.softDeleteMapping).not.toHaveBeenCalled();
    expect(logging.audit).not.toHaveBeenCalled();
  });
});
