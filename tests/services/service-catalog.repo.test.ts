/**
 * Clinic service reads — the mapping joined to its catalogue row.
 *
 * `KcServiceDoctorMapping` has no Prisma relation to `KcService`, so these are two
 * queries stitched in memory. The tests pin that shape, including the orphan case.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  kcServiceDoctorMapping: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
  kcService: { findMany: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

import { listClinicServices, findMappingById } from '@/repositories/wp/services.repo';

const mapping = {
  id: 501n,
  serviceId: 101n,
  doctorId: 8100001n,
  clinicId: 3n,
  charges: '250000',
  duration: 60,
  isPublic: 1,
  status: 1,
  telemedService: 'no',
  serviceNameAlias: null,
  createdAt: new Date('2026-05-01T00:00:00Z'),
};

const service = {
  id: 101n,
  name: 'Konseling Individu',
  type: 'psychology_services',
  category: '{"id":7,"label":"Psychology Services","value":"psychology_services"}',
};

beforeEach(() => {
  Object.values(db).forEach((m) => Object.values(m).forEach((f: any) => f.mockReset()));
});

describe('listClinicServices', () => {
  it('joins the mapping to its catalogue row', async () => {
    db.kcServiceDoctorMapping.findMany.mockResolvedValue([mapping]);
    db.kcServiceDoctorMapping.count.mockResolvedValue(1);
    db.kcService.findMany.mockResolvedValue([service]);

    const page = await listClinicServices({ page: 1, perPage: 20 });

    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: 501n,
      serviceId: 101n,
      name: 'Konseling Individu',
      type: 'psychology_services',
      charges: '250000',
      durationMinutes: 60,
      isActive: true,
      isPublic: true,
    });
  });

  it('filters to active mappings unless includeInactive is set', async () => {
    db.kcServiceDoctorMapping.findMany.mockResolvedValue([]);
    db.kcServiceDoctorMapping.count.mockResolvedValue(0);

    await listClinicServices({ page: 1, perPage: 20 });
    expect(db.kcServiceDoctorMapping.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 1 }) }),
    );

    db.kcServiceDoctorMapping.findMany.mockClear();
    await listClinicServices({ page: 1, perPage: 20, includeInactive: true });
    expect(db.kcServiceDoctorMapping.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('narrows by clinic and doctor when given', async () => {
    db.kcServiceDoctorMapping.findMany.mockResolvedValue([]);
    db.kcServiceDoctorMapping.count.mockResolvedValue(0);

    await listClinicServices({ page: 1, perPage: 20, clinicId: 3n, doctorId: 8100001n });

    expect(db.kcServiceDoctorMapping.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clinicId: 3n, doctorId: 8100001n }),
      }),
    );
  });

  it('resolves a name search through the catalogue first', async () => {
    db.kcService.findMany.mockResolvedValueOnce([{ id: 101n }]);
    db.kcServiceDoctorMapping.findMany.mockResolvedValue([mapping]);
    db.kcServiceDoctorMapping.count.mockResolvedValue(1);
    db.kcService.findMany.mockResolvedValueOnce([service]);

    await listClinicServices({ page: 1, perPage: 20, search: 'Konseling' });

    expect(db.kcServiceDoctorMapping.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ serviceId: { in: [101n] } }),
      }),
    );
  });

  it('short-circuits to an empty page when nothing matches the search', async () => {
    db.kcService.findMany.mockResolvedValueOnce([]);

    const page = await listClinicServices({ page: 1, perPage: 20, search: 'nope' });

    expect(page).toEqual({ items: [], total: 0, page: 1, perPage: 20 });
    expect(db.kcServiceDoctorMapping.findMany).not.toHaveBeenCalled();
  });

  it('drops a mapping whose catalogue row is gone rather than emitting a nameless entry', async () => {
    db.kcServiceDoctorMapping.findMany.mockResolvedValue([mapping]);
    db.kcServiceDoctorMapping.count.mockResolvedValue(1);
    db.kcService.findMany.mockResolvedValue([]);

    const page = await listClinicServices({ page: 1, perPage: 20 });

    expect(page.items).toHaveLength(0);
    expect(page.total).toBe(1);
  });
});

describe('the mapping select', () => {
  it('never asks MySQL for created_at', async () => {
    // `wp_kc_service_doctor_mapping.created_at` is `datetime NOT NULL`, but KiviCare filled
    // it with zero-dates -- 273 of 277 rows on staging read `0000-00-00 00:00:00`. Prisma
    // refuses to decode those, so selecting the column throws for essentially every row and
    // takes the whole endpoint down with it. This pins the omission so a later "it would be
    // nice to return createdAt" does not quietly reintroduce a production outage.
    db.kcServiceDoctorMapping.findMany.mockResolvedValue([]);
    db.kcServiceDoctorMapping.count.mockResolvedValue(0);

    await listClinicServices({ page: 1, perPage: 20 });

    const select = db.kcServiceDoctorMapping.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('createdAt');

    db.kcServiceDoctorMapping.findUnique.mockResolvedValue(null);
    await findMappingById(501n);
    expect(db.kcServiceDoctorMapping.findUnique.mock.calls[0][0].select).not.toHaveProperty('createdAt');
  });
});

describe('findMappingById', () => {
  it('returns the joined row', async () => {
    db.kcServiceDoctorMapping.findUnique.mockResolvedValue(mapping);
    db.kcService.findMany.mockResolvedValue([service]);

    const row = await findMappingById(501n);

    expect(row?.name).toBe('Konseling Individu');
    expect(row?.clinicId).toBe(3n);
  });

  it('returns an inactive mapping too — status is not a filter here', async () => {
    db.kcServiceDoctorMapping.findUnique.mockResolvedValue({ ...mapping, status: 0 });
    db.kcService.findMany.mockResolvedValue([service]);

    const row = await findMappingById(501n);

    expect(row?.isActive).toBe(false);
  });

  it('returns null when the mapping is missing', async () => {
    db.kcServiceDoctorMapping.findUnique.mockResolvedValue(null);

    expect(await findMappingById(999n)).toBeNull();
  });

  it('returns null when the catalogue row is gone', async () => {
    db.kcServiceDoctorMapping.findUnique.mockResolvedValue(mapping);
    db.kcService.findMany.mockResolvedValue([]);

    expect(await findMappingById(501n)).toBeNull();
  });
});
