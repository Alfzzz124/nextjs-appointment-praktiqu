import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({
  listClinicServices: vi.fn(),
  findMappingById: vi.fn(),
}));
vi.mock('@/repositories/wp/services.repo', () => repo);

// Tasks 7-9 add write, static-data and logging imports to the same module. Mocking them
// here keeps this file hermetic as the module grows, rather than quietly pulling a real
// Prisma client in behind it.
vi.mock('@/repositories/wp/services.write', () => ({
  findCatalogueByNameAndType: vi.fn(),
  createCatalogue: vi.fn(),
  doctorsMappedToClinic: vi.fn(),
  findConflictingMapping: vi.fn(),
  insertMapping: vi.fn(),
  updateMapping: vi.fn(),
  softDeleteMapping: vi.fn(),
  countBlockingAppointments: vi.fn(),
}));
vi.mock('@/repositories/wp/static-data.repo', () => ({ findServiceTypeById: vi.fn() }));
vi.mock('@/lib/logging', () => ({ audit: vi.fn() }));

import { listServices, getService } from '@/services/service-catalog/service';
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

const superAdmin: ServiceScope = { clinicId: null, doctorId: null, empty: false };
const clinicAdmin: ServiceScope = { clinicId: 3n, doctorId: null, empty: false };
const otherClinic: ServiceScope = { clinicId: 9n, doctorId: null, empty: false };
const professional: ServiceScope = { clinicId: null, doctorId: 8100001n, empty: false };
const nothing: ServiceScope = { clinicId: null, doctorId: null, empty: true };

beforeEach(() => {
  repo.listClinicServices.mockReset();
  repo.findMappingById.mockReset();
  repo.listClinicServices.mockResolvedValue({ items: [row], total: 1, page: 1, perPage: 20 });
});

describe('listServices', () => {
  it('parses the category snapshot and normalises ids to numbers', async () => {
    const res = await listServices({ page: 1, perPage: 20 } as any, superAdmin);

    expect(res.services[0]).toMatchObject({
      id: 501,
      serviceId: 101,
      doctorId: 8100001,
      clinicId: 3,
      name: 'Konseling Individu',
      price: 250000,
      durationMinutes: 60,
      telemedService: 'no',
    });
    expect(res.services[0].category).toEqual({
      id: 7,
      label: 'Psychology Services',
      value: 'psychology_services',
    });
  });

  it('survives a category snapshot that is not valid JSON', async () => {
    repo.listClinicServices.mockResolvedValue({
      items: [{ ...row, category: 'not json' }],
      total: 1,
      page: 1,
      perPage: 20,
    });

    const res = await listServices({ page: 1, perPage: 20 } as any, superAdmin);
    expect(res.services[0].category).toBeNull();
  });

  it("lets the scope's clinic override whatever the caller asked for", async () => {
    await listServices({ page: 1, perPage: 20, clinicId: 99 } as any, clinicAdmin);

    expect(repo.listClinicServices).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 3n }),
    );
  });

  it('honours a clinicId filter when the scope is unrestricted', async () => {
    await listServices({ page: 1, perPage: 20, clinicId: 99 } as any, superAdmin);

    expect(repo.listClinicServices).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 99n }),
    );
  });

  it("pins a professional to their own rows regardless of professionalId", async () => {
    await listServices({ page: 1, perPage: 20, professionalId: 42 } as any, professional);

    expect(repo.listClinicServices).toHaveBeenCalledWith(
      expect.objectContaining({ doctorId: 8100001n }),
    );
  });

  it('returns an empty page for an empty scope without touching the database', async () => {
    const res = await listServices({ page: 2, perPage: 20 } as any, nothing);

    expect(res).toEqual({ services: [], total: 0, page: 2, perPage: 20 });
    expect(repo.listClinicServices).not.toHaveBeenCalled();
  });
});

describe('getService', () => {
  it('returns the mapping when it is in scope', async () => {
    repo.findMappingById.mockResolvedValue(row);

    expect((await getService(501, clinicAdmin))?.id).toBe(501);
  });

  it('returns null for a mapping in another clinic — the route turns this into a 404', async () => {
    repo.findMappingById.mockResolvedValue(row);

    expect(await getService(501, otherClinic)).toBeNull();
  });

  it("returns null for another professional's mapping", async () => {
    repo.findMappingById.mockResolvedValue(row);

    expect(await getService(501, { clinicId: null, doctorId: 999n, empty: false })).toBeNull();
  });

  it('returns null when the mapping does not exist', async () => {
    repo.findMappingById.mockResolvedValue(null);

    expect(await getService(501, superAdmin)).toBeNull();
  });

  it('returns null for an empty scope without touching the database', async () => {
    expect(await getService(501, nothing)).toBeNull();
    expect(repo.findMappingById).not.toHaveBeenCalled();
  });
});
