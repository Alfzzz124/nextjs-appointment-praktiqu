import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({ listClinicServices: vi.fn(), findMappingById: vi.fn(), listOptionRowsOf: vi.fn() }));
vi.mock('@/repositories/wp/services.repo', () => repo);

const write = vi.hoisted(() => ({
  findCatalogueByNameAndType: vi.fn(),
  createCatalogue: vi.fn(),
  doctorsMappedToClinic: vi.fn(),
  findConflictingMapping: vi.fn(),
  insertMapping: vi.fn(),
  saveServiceUpdate: vi.fn(),
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
  repo.listOptionRowsOf.mockReset();
  repo.listOptionRowsOf.mockResolvedValue([]);
  staticData.findServiceTypeById.mockReset();
  logging.audit.mockReset();

  repo.findMappingById.mockResolvedValue(row);
  write.findConflictingMapping.mockResolvedValue(null);
  write.saveServiceUpdate.mockResolvedValue(undefined);
});

const expectError = async (fn: () => Promise<unknown>, tag: string) => {
  await expect(fn()).rejects.toMatchObject({ _tag: tag });
};

/** The parent patch handed to the one transactional save. */
const parentPatch = () => write.saveServiceUpdate.mock.calls[0][0].parent.patch;

describe('updateService', () => {
  it('writes price into charges and leaves the shared catalogue row alone', async () => {
    await updateService(501, { price: 300000 }, clinicAdmin, 'actor-1');

    expect(parentPatch()).toEqual({ charges: '300000' });
    expect(write.createCatalogue).not.toHaveBeenCalled();
  });

  it('patches only the fields it was given', async () => {
    await updateService(501, { duration: 90, status: 0 }, clinicAdmin, 'actor-1');

    expect(parentPatch()).toEqual({ duration: 90, status: 0 });
  });

  it('repoints to an existing catalogue row on rename instead of renaming it', async () => {
    staticData.findServiceTypeById.mockResolvedValue({
      id: 7n, label: 'Psychology Services', value: 'psychology_services',
    });
    write.findCatalogueByNameAndType.mockResolvedValue({ id: 909n });

    await updateService(501, { name: 'Terapi Keluarga' }, clinicAdmin, 'actor-1');

    expect(write.createCatalogue).not.toHaveBeenCalled();
    expect(parentPatch()).toEqual({ serviceId: 909n });
  });

  it('creates a new catalogue row when the new name and type are unknown', async () => {
    staticData.findServiceTypeById.mockResolvedValue({
      id: 7n, label: 'Psychology Services', value: 'psychology_services',
    });
    write.findCatalogueByNameAndType.mockResolvedValue(null);
    write.createCatalogue.mockResolvedValue(202n);

    await updateService(501, { name: 'Terapi Keluarga' }, clinicAdmin, 'actor-1');

    // A rename with no price change must seed the new row with the existing charges,
    // not fall back to some other default — `objectContaining` on `name`/`type` alone
    // would let a wrong `price` fallback pass silently.
    expect(write.createCatalogue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Terapi Keluarga', type: 'psychology_services', price: row.charges }),
    );
    expect(parentPatch()).toEqual({ serviceId: 202n });
  });

  it('seeds a new catalogue row with the new price when renaming and changing price together', async () => {
    staticData.findServiceTypeById.mockResolvedValue({
      id: 7n, label: 'Psychology Services', value: 'psychology_services',
    });
    write.findCatalogueByNameAndType.mockResolvedValue(null);
    write.createCatalogue.mockResolvedValue(202n);

    await updateService(501, { name: 'Terapi Keluarga', price: 400000 }, clinicAdmin, 'actor-1');

    expect(write.createCatalogue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Terapi Keluarga', type: 'psychology_services', price: '400000' }),
    );
    expect(parentPatch()).toEqual({ charges: '400000', serviceId: 202n });
  });

  it('repoints on a category change even when the name is unchanged', async () => {
    staticData.findServiceTypeById.mockResolvedValue({
      id: 9n, label: 'Assessment', value: 'assessment',
    });
    write.findCatalogueByNameAndType.mockResolvedValue(null);
    write.createCatalogue.mockResolvedValue(303n);

    await updateService(501, { categoryId: 9 }, clinicAdmin, 'actor-1');

    expect(write.findCatalogueByNameAndType).toHaveBeenCalledWith('Konseling Individu', 'assessment');
    expect(parentPatch()).toEqual({ serviceId: 303n });
  });

  it('does not repoint when the given categoryId matches the row\'s current category', async () => {
    await updateService(501, { categoryId: 7 }, clinicAdmin, 'actor-1');

    // `row.category` parses to id 7 — the same id the request supplies. Treating this
    // as a no-op change (not a recategorise) means no catalogue lookup at all, since a
    // duplicate (name, type) row could otherwise get picked and the mapping silently
    // repointed away from the row it is already on.
    expect(staticData.findServiceTypeById).not.toHaveBeenCalled();
    expect(write.findCatalogueByNameAndType).not.toHaveBeenCalled();
    expect(write.createCatalogue).not.toHaveBeenCalled();
    expect(parentPatch()).toEqual({});
  });

  it('still repoints when the given categoryId differs from the current category', async () => {
    staticData.findServiceTypeById.mockResolvedValue({
      id: 9n, label: 'Assessment', value: 'assessment',
    });
    write.findCatalogueByNameAndType.mockResolvedValue({ id: 303n });

    await updateService(501, { categoryId: 9 }, clinicAdmin, 'actor-1');

    expect(write.findCatalogueByNameAndType).toHaveBeenCalledWith('Konseling Individu', 'assessment');
    expect(parentPatch()).toEqual({ serviceId: 303n });
  });

  it('repoints when categoryId is supplied and the existing category cannot be parsed', async () => {
    repo.findMappingById.mockResolvedValue({ ...row, category: null });
    staticData.findServiceTypeById.mockResolvedValue({
      id: 7n, label: 'Psychology Services', value: 'psychology_services',
    });
    write.findCatalogueByNameAndType.mockResolvedValue({ id: 909n });

    await updateService(501, { categoryId: 7 }, clinicAdmin, 'actor-1');

    // The current category id is unknowable from a null snapshot, so the supplied
    // categoryId must count as a change even though it happens to equal what the row
    // would have had if it parsed.
    expect(write.findCatalogueByNameAndType).toHaveBeenCalledWith('Konseling Individu', 'psychology_services');
    expect(parentPatch()).toEqual({ serviceId: 909n });
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
    expect(write.saveServiceUpdate).not.toHaveBeenCalled();
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

  it('does not audit a no-op update that changes nothing', async () => {
    await updateService(501, { name: row.name }, clinicAdmin, 'actor-1');

    // `patch` ends up empty and the transactional save has nothing to write for it, but the
    // audit trail must follow suit rather than recording a change that never happened.
    expect(parentPatch()).toEqual({});
    expect(logging.audit).not.toHaveBeenCalled();
  });
});

describe('updateService — duration options', () => {
  const option = (id: bigint, serviceId: bigint, minutes: number, extra: Partial<Record<string, unknown>> = {}) => ({
    ...row, id, serviceId, name: `Konseling Individu (${minutes} menit)`, charges: '600000',
    durationMinutes: minutes, optionOf: { parentId: 501n, removed: false }, ...extra,
  });
  const saved = () => write.saveServiceUpdate.mock.calls[0][0];

  beforeEach(() => {
    write.countBlockingAppointments.mockResolvedValue(0);
    write.findCatalogueByNameAndType.mockResolvedValue(null);
    write.createCatalogue.mockResolvedValue(909n);
  });

  it('refuses to edit an option row directly', async () => {
    repo.findMappingById.mockResolvedValue({ ...row, id: 601n, optionOf: { parentId: 501n, removed: false } });

    await expect(updateService(601, { price: 1 }, clinicAdmin, 'a')).rejects.toMatchObject({
      _tag: 'unprocessable', code: 'edit_via_parent',
    });
    expect(write.saveServiceUpdate).not.toHaveBeenCalled();
  });

  it('creates a new option inheriting doctor, clinic, telemed, status and visibility', async () => {
    await updateService(501, { durationOptions: [{ duration: 90, price: 600000 }] }, clinicAdmin, 'a');

    expect(write.findCatalogueByNameAndType).toHaveBeenCalledWith('Konseling Individu (90 menit)', 'psychology_services');
    expect(write.createCatalogue).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Konseling Individu (90 menit)', type: 'psychology_services', price: '600000', status: 1,
    }));
    expect(saved().optionInserts).toEqual([{
      parentMappingId: 501n, serviceId: 909n, doctorId: 8100001n, clinicId: 3n,
      charges: '600000', duration: 90, telemedService: 'no', status: 1, isPublic: 1,
    }]);
  });

  it('removes an option not in the list', async () => {
    repo.listOptionRowsOf.mockResolvedValue([option(601n, 201n, 90)]);

    await updateService(501, { durationOptions: [] }, clinicAdmin, 'a');

    expect(saved().optionRemovals).toEqual([{ mappingId: 601n, parentMappingId: 501n }]);
  });

  it('refuses to remove an option an upcoming booking uses, and says how many', async () => {
    repo.listOptionRowsOf.mockResolvedValue([option(601n, 201n, 90)]);
    write.countBlockingAppointments.mockResolvedValue(2);

    await expect(updateService(501, { durationOptions: [] }, clinicAdmin, 'a')).rejects.toMatchObject({
      _tag: 'conflict', code: 'duration_option_has_appointments', count: 2,
    });
    expect(write.countBlockingAppointments).toHaveBeenCalledWith({ serviceId: 201n, doctorId: 8100001n });
    expect(write.saveServiceUpdate).not.toHaveBeenCalled();
  });

  it("refuses to change an option's length under an upcoming booking, but allows a price change", async () => {
    repo.listOptionRowsOf.mockResolvedValue([option(601n, 201n, 90)]);
    write.countBlockingAppointments.mockResolvedValue(1);

    await expect(updateService(501, { durationOptions: [{ id: 601, duration: 120, price: 600000 }] }, clinicAdmin, 'a'))
      .rejects.toMatchObject({ code: 'duration_option_has_appointments' });

    write.saveServiceUpdate.mockClear();
    await updateService(501, { durationOptions: [{ id: 601, duration: 90, price: 650000 }] }, clinicAdmin, 'a');
    expect(saved().optionUpdates).toEqual([{ mappingId: 601n, patch: { charges: '650000' } }]);
  });

  it('renames and repoints an option whose duration changes', async () => {
    repo.listOptionRowsOf.mockResolvedValue([option(601n, 201n, 90)]);

    await updateService(501, { durationOptions: [{ id: 601, duration: 120, price: 600000 }] }, clinicAdmin, 'a');

    expect(write.findCatalogueByNameAndType).toHaveBeenCalledWith('Konseling Individu (120 menit)', 'psychology_services');
    expect(saved().optionUpdates).toEqual([{ mappingId: 601n, patch: { duration: 120, serviceId: 909n } }]);
  });

  it('carries a parent rename onto its options without being asked', async () => {
    repo.listOptionRowsOf.mockResolvedValue([option(601n, 201n, 90)]);
    write.findCatalogueByNameAndType.mockImplementation(async (name: string) =>
      name === 'Terapi Keluarga' ? { id: 808n } : null);

    await updateService(501, { name: 'Terapi Keluarga' }, clinicAdmin, 'a');

    expect(parentPatch()).toEqual({ serviceId: 808n });
    expect(write.createCatalogue).toHaveBeenCalledWith(expect.objectContaining({ name: 'Terapi Keluarga (90 menit)' }));
    expect(saved().optionUpdates).toEqual([{ mappingId: 601n, patch: { serviceId: 909n } }]);
  });

  it('copies status, visibility and telemed from the parent onto every live option', async () => {
    repo.listOptionRowsOf.mockResolvedValue([
      option(601n, 201n, 90),
      option(602n, 202n, 120, { isActive: false, optionOf: { parentId: 501n, removed: true } }),
    ]);

    await updateService(501, { status: 0, isPublic: 0, telemedService: 'yes' }, clinicAdmin, 'a');

    // The removed option (602) is not live: it is neither cascaded to nor removed again.
    expect(saved().optionUpdates).toEqual([
      { mappingId: 601n, patch: { telemedService: 'yes', status: 0, isPublic: 0 } },
    ]);
    expect(saved().optionRemovals).toEqual([]);
  });

  it("refuses a parent duration equal to an option's", async () => {
    repo.listOptionRowsOf.mockResolvedValue([option(601n, 201n, 90)]);

    await expect(updateService(501, { duration: 90 }, clinicAdmin, 'a')).rejects.toMatchObject({
      _tag: 'unprocessable', code: 'duration_option_duplicate',
    });
    expect(write.saveServiceUpdate).not.toHaveBeenCalled();
  });

  it('refuses more than four options', async () => {
    const durationOptions = [30, 45, 90, 120, 150].map((duration) => ({ duration, price: 1 }));
    await expect(updateService(501, { durationOptions }, clinicAdmin, 'a')).rejects.toMatchObject({
      code: 'duration_option_limit',
    });
  });

  it("refuses an option name another of this professional's services already has, writing nothing", async () => {
    write.findConflictingMapping.mockResolvedValue({ mappingId: 700n, doctorId: 8100001n });

    await expect(updateService(501, { durationOptions: [{ duration: 90, price: 1 }] }, clinicAdmin, 'a'))
      .rejects.toMatchObject({ _tag: 'conflict', code: 'service_name_taken' });
    expect(write.createCatalogue).not.toHaveBeenCalled();
    expect(write.saveServiceUpdate).not.toHaveBeenCalled();
  });

  it('leaves the parent and its options out of the option-name conflict check, removed ones included', async () => {
    repo.listOptionRowsOf.mockResolvedValue([
      option(602n, 202n, 120, { isActive: false, optionOf: { parentId: 501n, removed: true } }),
    ]);

    await updateService(501, { durationOptions: [{ duration: 120, price: 1 }] }, clinicAdmin, 'a');

    expect(write.findConflictingMapping).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Konseling Individu (120 menit)', excludeMappingIds: [501n, 602n],
    }));
  });

  it('audits option changes even when the parent itself is unchanged', async () => {
    await updateService(501, { durationOptions: [{ duration: 90, price: 600000 }] }, clinicAdmin, 'a');

    expect(logging.audit).toHaveBeenCalledWith('service.updated', expect.objectContaining({
      metadata: expect.objectContaining({ durationOptions: { created: [90], changed: [], removed: [] } }),
    }));
  });
});
