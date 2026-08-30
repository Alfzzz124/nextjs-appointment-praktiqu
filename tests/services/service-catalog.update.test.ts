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

import { updateService } from '@/services/service-catalog/service';
import type { ServiceScope } from '@/services/service-catalog/scope';

const row = {
  id: 501n,
  serviceId: 101n,
  doctorId: 8100001n,
  clinicId: 3n,
  name: 'Konseling Individu',
  type: 'psychology_services',
  category: '{"id":7,"label":"Psychology Services","value":"psychology_services"}',
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
  staticData.findServiceTypeById.mockReset();
  logging.audit.mockReset();

  repo.findMappingById.mockResolvedValue(row);
  write.findConflictingMapping.mockResolvedValue(null);
  write.updateMapping.mockResolvedValue(undefined);
});

const expectError = async (fn: () => Promise<unknown>, tag: string) => {
  await expect(fn()).rejects.toMatchObject({ _tag: tag });
};

describe('updateService', () => {
  it('writes price into charges and leaves the shared catalogue row alone', async () => {
    await updateService(501, { price: 300000 }, clinicAdmin, 'actor-1');

    expect(write.updateMapping).toHaveBeenCalledWith(501n, { charges: '300000' });
    expect(write.createCatalogue).not.toHaveBeenCalled();
  });

  it('patches only the fields it was given', async () => {
    await updateService(501, { duration: 90, status: 0 }, clinicAdmin, 'actor-1');

    expect(write.updateMapping).toHaveBeenCalledWith(501n, { duration: 90, status: 0 });
  });

  it('repoints to an existing catalogue row on rename instead of renaming it', async () => {
    staticData.findServiceTypeById.mockResolvedValue({
      id: 7n, label: 'Psychology Services', value: 'psychology_services',
    });
    write.findCatalogueByNameAndType.mockResolvedValue({ id: 909n });

    await updateService(501, { name: 'Terapi Keluarga' }, clinicAdmin, 'actor-1');

    expect(write.createCatalogue).not.toHaveBeenCalled();
    expect(write.updateMapping).toHaveBeenCalledWith(501n, { serviceId: 909n });
  });

  it('creates a new catalogue row when the new name and type are unknown', async () => {
    staticData.findServiceTypeById.mockResolvedValue({
      id: 7n, label: 'Psychology Services', value: 'psychology_services',
    });
    write.findCatalogueByNameAndType.mockResolvedValue(null);
    write.createCatalogue.mockResolvedValue(202n);

    await updateService(501, { name: 'Terapi Keluarga' }, clinicAdmin, 'actor-1');

    expect(write.createCatalogue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Terapi Keluarga', type: 'psychology_services' }),
    );
    expect(write.updateMapping).toHaveBeenCalledWith(501n, { serviceId: 202n });
  });

  it('repoints on a category change even when the name is unchanged', async () => {
    staticData.findServiceTypeById.mockResolvedValue({
      id: 9n, label: 'Assessment', value: 'assessment',
    });
    write.findCatalogueByNameAndType.mockResolvedValue(null);
    write.createCatalogue.mockResolvedValue(303n);

    await updateService(501, { categoryId: 9 }, clinicAdmin, 'actor-1');

    expect(write.findCatalogueByNameAndType).toHaveBeenCalledWith('Konseling Individu', 'assessment');
    expect(write.updateMapping).toHaveBeenCalledWith(501n, { serviceId: 303n });
  });

  it('rejects a rename that collides with another service of the same professional', async () => {
    staticData.findServiceTypeById.mockResolvedValue({
      id: 7n, label: 'Psychology Services', value: 'psychology_services',
    });
    write.findConflictingMapping.mockResolvedValue({ mappingId: 600n, doctorId: 8100001n });

    await expectError(
      () => updateService(501, { name: 'Terapi Keluarga' }, clinicAdmin, 'actor-1'),
      'conflict',
    );
    expect(write.updateMapping).not.toHaveBeenCalled();
  });

  it('excludes the row being edited from the collision check', async () => {
    staticData.findServiceTypeById.mockResolvedValue({
      id: 7n, label: 'Psychology Services', value: 'psychology_services',
    });
    write.findCatalogueByNameAndType.mockResolvedValue({ id: 909n });

    await updateService(501, { name: 'Terapi Keluarga' }, clinicAdmin, 'actor-1');

    expect(write.findConflictingMapping).toHaveBeenCalledWith(
      expect.objectContaining({ excludeMappingId: 501n }),
    );
  });

  it('rejects an unknown category', async () => {
    staticData.findServiceTypeById.mockResolvedValue(null);

    await expectError(() => updateService(501, { categoryId: 99 }, clinicAdmin, 'actor-1'), 'validation');
  });

  it('404s a mapping in another clinic', async () => {
    await expectError(() => updateService(501, { price: 1 }, otherClinic, 'actor-1'), 'not_found');
  });

  it('404s a mapping that does not exist', async () => {
    repo.findMappingById.mockResolvedValue(null);

    await expectError(() => updateService(501, { price: 1 }, clinicAdmin, 'actor-1'), 'not_found');
  });

  it('audits the update', async () => {
    await updateService(501, { price: 300000 }, clinicAdmin, 'actor-1');

    expect(logging.audit).toHaveBeenCalledWith(
      'service.updated',
      expect.objectContaining({ userId: 'actor-1', resource: 'service', resourceId: '501' }),
    );
  });
});
