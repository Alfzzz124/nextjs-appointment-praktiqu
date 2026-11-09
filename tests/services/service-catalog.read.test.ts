import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({
  listClinicServices: vi.fn(),
  findMappingById: vi.fn(),
  listOptionRowsOf: vi.fn(),
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
  repo.listOptionRowsOf.mockReset();
  repo.listOptionRowsOf.mockResolvedValue([]);
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

  it('returns null rather than NaN for a charges string KiviCare never constrained', async () => {
    // `charges` is a free-form varchar; legacy rows hold things like "Rp 250.000" or "-".
    // NaN is not representable in JSON, so it would reach the client as null anyway --
    // but typed as a number, silently conflated with "no price set".
    for (const charges of ['Rp 250.000', '-', '', '250.000,00']) {
      repo.listClinicServices.mockResolvedValue({
        items: [{ ...row, charges }],
        total: 1,
        page: 1,
        perPage: 20,
      });

      const res = await listServices({ page: 1, perPage: 20 } as any, superAdmin);
      expect(res.services[0].price, `charges=${JSON.stringify(charges)}`).toBeNull();
    }
  });

  it("still reads '0' as a free service, not as an unset price", async () => {
    repo.listClinicServices.mockResolvedValue({
      items: [{ ...row, charges: '0' }],
      total: 1,
      page: 1,
      perPage: 20,
    });

    const res = await listServices({ page: 1, perPage: 20 } as any, superAdmin);
    expect(res.services[0].price).toBe(0);
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

describe('duration options in summaries', () => {
  const option = {
    ...row, id: 601n, serviceId: 201n, name: 'Konseling Individu (90 menit)', charges: '600000',
    durationMinutes: 90, optionOf: { parentId: 501n, removed: false },
  };
  const removed = {
    ...row, id: 602n, serviceId: 202n, name: 'Konseling Individu (120 menit)', charges: '800000',
    durationMinutes: 120, isActive: false, optionOf: { parentId: 501n, removed: true },
  };

  it('lists an option flat, pointing at its parent, and the parent carries its live options', async () => {
    repo.listClinicServices.mockResolvedValue({ items: [{ ...row, optionOf: null }, option], total: 2, page: 1, perPage: 20 });
    repo.listOptionRowsOf.mockResolvedValue([option, removed]);

    const res = await listServices({ page: 1, perPage: 20 } as any, superAdmin);

    expect(repo.listOptionRowsOf).toHaveBeenCalledWith([501n]);
    expect(res.services[0].durationOf).toBeNull();
    expect(res.services[0].durationOptions).toEqual([
      { id: 601, serviceId: 201, name: 'Konseling Individu (90 menit)', durationMinutes: 90, price: 600000, isActive: true },
    ]);
    expect(res.services[1].durationOf).toBe(501);
    expect(res.services[1].durationOptions).toEqual([]);
  });

  it('getService on an option reports its parent and no options of its own', async () => {
    repo.findMappingById.mockResolvedValue(option);

    const svc = await getService(601, superAdmin);

    expect(svc!.durationOf).toBe(501);
    expect(svc!.durationOptions).toEqual([]);
    expect(repo.listOptionRowsOf).not.toHaveBeenCalled();
  });

  it('a removed option still reports its parent', async () => {
    repo.findMappingById.mockResolvedValue(removed);
    expect((await getService(602, superAdmin))!.durationOf).toBe(501);
  });
});
