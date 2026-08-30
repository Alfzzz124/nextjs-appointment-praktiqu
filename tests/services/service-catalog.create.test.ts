import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({ listClinicServices: vi.fn(), findMappingById: vi.fn() }));
vi.mock('@/repositories/wp/services.repo', () => repo);

const write = vi.hoisted(() => ({
  findCatalogueByNameAndType: vi.fn(),
  createCatalogue: vi.fn(),
  createServiceWithMappings: vi.fn(),
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
  write.createServiceWithMappings.mockResolvedValue({ serviceId: 101n, mappingIds: [501n, 502n] });
});

const expectError = async (fn: () => Promise<unknown>, tag: string) => {
  await expect(fn()).rejects.toMatchObject({ _tag: tag });
};

describe('createService', () => {
  it('creates one catalogue row and one mapping per psychologist, in a single transaction', async () => {
    const result = await createService(input, 3, 'actor-1');

    expect(write.createServiceWithMappings).toHaveBeenCalledTimes(1);
    const call = write.createServiceWithMappings.mock.calls[0][0];
    expect(call.catalogue).toEqual({
      name: 'Konseling Individu',
      type: 'psychology_services',
      category: '{"id":7,"label":"Psychology Services","value":"psychology_services"}',
      price: '250000',
      status: 1,
    });
    expect(call.mappings).toHaveLength(2);
    expect(result.mappings).toEqual([
      { id: 501, doctorId: 8100001 },
      { id: 502, doctorId: 8100002 },
    ]);
  });

  it('writes the price as a string into both the catalogue row and every mapping', async () => {
    await createService(input, 3, 'actor-1');

    const call = write.createServiceWithMappings.mock.calls[0][0];
    expect(call.catalogue.price).toBe('250000');
    expect(call.mappings[0].charges).toBe('250000');
    expect(call.mappings[1].charges).toBe('250000');
  });

  it('reuses an existing catalogue row with the same name and type', async () => {
    write.findCatalogueByNameAndType.mockResolvedValue({ id: 909n });
    write.createServiceWithMappings.mockResolvedValue({ serviceId: 909n, mappingIds: [501n, 502n] });

    const result = await createService(input, 3, 'actor-1');

    const call = write.createServiceWithMappings.mock.calls[0][0];
    expect(call.catalogue).toEqual({ reuseId: 909n });
    expect(result.serviceId).toBe(909);
  });

  it('rejects an unknown category with a validation error', async () => {
    staticData.findServiceTypeById.mockResolvedValue(null);
    await expectError(() => createService(input, 3, 'actor-1'), 'validation');
    expect(write.createServiceWithMappings).not.toHaveBeenCalled();
  });

  it('rejects psychologists who do not work at the clinic', async () => {
    write.doctorsMappedToClinic.mockResolvedValue([8100001n]);
    await expectError(() => createService(input, 3, 'actor-1'), 'bad_request');
    expect(write.createServiceWithMappings).not.toHaveBeenCalled();
  });

  it('rejects a duplicate offering with a conflict', async () => {
    write.findConflictingMapping.mockResolvedValue({ mappingId: 400n, doctorId: 8100001n });
    await expectError(() => createService(input, 3, 'actor-1'), 'conflict');
    expect(write.createServiceWithMappings).not.toHaveBeenCalled();
  });

  it('checks for a duplicate before writing anything', async () => {
    write.findConflictingMapping.mockResolvedValue({ mappingId: 400n, doctorId: 8100001n });
    await createService(input, 3, 'actor-1').catch(() => undefined);
    expect(write.createServiceWithMappings).not.toHaveBeenCalled();
  });

  it('audits the creation', async () => {
    await createService(input, 3, 'actor-1');

    expect(logging.audit).toHaveBeenCalledWith(
      'service.created',
      expect.objectContaining({ userId: 'actor-1', resource: 'service' }),
    );
  });

  it('surfaces a failure from the atomic create with no partial result, and does not audit', async () => {
    write.createServiceWithMappings.mockRejectedValue(new Error('third mapping insert failed'));

    await expect(createService(input, 3, 'actor-1')).rejects.toThrow('third mapping insert failed');
    expect(logging.audit).not.toHaveBeenCalled();
  });

  it('de-duplicates doctorIds before any check runs, preserving first-seen order', async () => {
    const dupInput = { ...input, doctorIds: [8100001, 8100001, 8100002] };

    const result = await createService(dupInput, 3, 'actor-1');

    expect(write.doctorsMappedToClinic).toHaveBeenCalledWith([8100001n, 8100002n], 3n);
    expect(write.findConflictingMapping).toHaveBeenCalledWith(
      expect.objectContaining({ doctorIds: [8100001n, 8100002n] }),
    );
    const call = write.createServiceWithMappings.mock.calls[0][0];
    expect(call.mappings).toHaveLength(2);
    expect(result.mappings).toEqual([
      { id: 501, doctorId: 8100001 },
      { id: 502, doctorId: 8100002 },
    ]);
  });
});
