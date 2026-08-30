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

import { createService } from '@/services/service-catalog/service';

const input = {
  name: 'Konseling Individu',
  categoryId: 7,
  price: 250000,
  duration: 60,
  doctorIds: [8100001, 8100002],
  telemedService: 'no' as const,
  status: 1 as const,
  isPublic: 1 as const,
};

const category = {
  id: 7n,
  type: 'service_type',
  label: 'Psychology Services',
  value: 'psychology_services',
  parentId: null,
  isActive: true,
  createdAt: new Date(),
};

beforeEach(() => {
  Object.values(write).forEach((f) => f.mockReset());
  staticData.findServiceTypeById.mockReset();
  logging.audit.mockReset();

  staticData.findServiceTypeById.mockResolvedValue(category);
  write.doctorsMappedToClinic.mockResolvedValue([8100001n, 8100002n]);
  write.findConflictingMapping.mockResolvedValue(null);
  write.findCatalogueByNameAndType.mockResolvedValue(null);
  write.createCatalogue.mockResolvedValue(101n);
  write.insertMapping.mockResolvedValueOnce(501n).mockResolvedValueOnce(502n);
});

const expectError = async (fn: () => Promise<unknown>, tag: string) => {
  await expect(fn()).rejects.toMatchObject({ _tag: tag });
};

describe('createService', () => {
  it('creates one catalogue row and one mapping per psychologist', async () => {
    const result = await createService(input, 3, 'actor-1');

    expect(write.createCatalogue).toHaveBeenCalledWith({
      name: 'Konseling Individu',
      type: 'psychology_services',
      category: '{"id":7,"label":"Psychology Services","value":"psychology_services"}',
      price: '250000',
      status: 1,
    });
    expect(write.insertMapping).toHaveBeenCalledTimes(2);
    expect(result.mappings).toEqual([
      { id: 501, doctorId: 8100001 },
      { id: 502, doctorId: 8100002 },
    ]);
  });

  it('writes the price as a string into both columns', async () => {
    await createService(input, 3, 'actor-1');

    expect(write.createCatalogue.mock.calls[0][0].price).toBe('250000');
    expect(write.insertMapping.mock.calls[0][0].charges).toBe('250000');
  });

  it('reuses an existing catalogue row with the same name and type', async () => {
    write.findCatalogueByNameAndType.mockResolvedValue({ id: 909n });

    const result = await createService(input, 3, 'actor-1');

    expect(write.createCatalogue).not.toHaveBeenCalled();
    expect(result.serviceId).toBe(909);
    expect(write.insertMapping.mock.calls[0][0].serviceId).toBe(909n);
  });

  it('rejects an unknown category with a validation error', async () => {
    staticData.findServiceTypeById.mockResolvedValue(null);
    await expectError(() => createService(input, 3, 'actor-1'), 'validation');
    expect(write.insertMapping).not.toHaveBeenCalled();
  });

  it('rejects psychologists who do not work at the clinic', async () => {
    write.doctorsMappedToClinic.mockResolvedValue([8100001n]);
    await expectError(() => createService(input, 3, 'actor-1'), 'bad_request');
    expect(write.insertMapping).not.toHaveBeenCalled();
  });

  it('rejects a duplicate offering with a conflict', async () => {
    write.findConflictingMapping.mockResolvedValue({ mappingId: 400n, doctorId: 8100001n });
    await expectError(() => createService(input, 3, 'actor-1'), 'conflict');
    expect(write.insertMapping).not.toHaveBeenCalled();
  });

  it('checks for a duplicate before creating any catalogue row', async () => {
    write.findConflictingMapping.mockResolvedValue({ mappingId: 400n, doctorId: 8100001n });
    await createService(input, 3, 'actor-1').catch(() => undefined);
    expect(write.createCatalogue).not.toHaveBeenCalled();
  });

  it('audits the creation', async () => {
    await createService(input, 3, 'actor-1');

    expect(logging.audit).toHaveBeenCalledWith(
      'service.created',
      expect.objectContaining({ userId: 'actor-1', resource: 'service' }),
    );
  });
});
