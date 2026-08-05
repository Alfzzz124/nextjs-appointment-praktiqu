/**
 * Contract tests for the WordPress static-data (lookup) repository.
 *
 * Specializations, blood groups and qualifications live in `wp_kc_static_data`, keyed
 * by `type`. Our schema duplicates specializations as `specialties` +
 * `_DoctorToSpecialty`. See docs/architecture/shadow-tables-audit.md.
 *
 * These tests require the full KiviCare schema — run
 * `node scripts/provision-kivicare-test-schema.mjs` if wp_kc_static_data is missing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../billing/fixtures';
import {
  STATIC_DATA_TYPE,
  listBloodGroups,
  listSpecializations,
  listStaticData,
} from '@/repositories/wp/static-data.repo';

/** Test-owned range, below the billing fixtures' unbounded `>= 9_000_000` cleanup. */
const BASE = 8_900_000;
const END = BASE + 100_000;

async function seed(opts: {
  id: number;
  type: string;
  label: string;
  value?: string;
  status?: number;
}) {
  await prisma.kcStaticData.create({
    data: {
      id: BigInt(opts.id),
      type: opts.type,
      label: opts.label,
      value: opts.value ?? opts.label,
      status: BigInt(opts.status ?? 1),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    } as never,
  });
}

describe('wp static data repository', () => {
  beforeAll(async () => {
    assertTestDb();
    await prisma.kcStaticData.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });

    await seed({ id: BASE + 1, type: STATIC_DATA_TYPE.SPECIALIZATION, label: 'Psikolog Klinis' });
    await seed({ id: BASE + 2, type: STATIC_DATA_TYPE.SPECIALIZATION, label: 'Psikiater' });
    await seed({ id: BASE + 3, type: STATIC_DATA_TYPE.SPECIALIZATION, label: 'Konselor Lama', status: 0 });
    await seed({ id: BASE + 4, type: STATIC_DATA_TYPE.BLOOD_GROUP, label: 'O+' });
    await seed({ id: BASE + 5, type: STATIC_DATA_TYPE.QUALIFICATION, label: 'M.Psi' });
  });

  afterAll(async () => {
    await prisma.kcStaticData.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
    await prisma.$disconnect();
  });

  it('exposes the type vocabulary KiviCare uses', () => {
    expect(STATIC_DATA_TYPE.SPECIALIZATION).toBe('specialization');
    expect(STATIC_DATA_TYPE.BLOOD_GROUP).toBe('blood_group');
    expect(STATIC_DATA_TYPE.QUALIFICATION).toBe('qualification');
    expect(STATIC_DATA_TYPE.SERVICE_LIST).toBe('service_list');
  });

  it('lists active entries of a type', async () => {
    const items = await listSpecializations();
    const ids = items.map((i) => Number(i.id));

    expect(ids).toContain(BASE + 1);
    expect(ids).toContain(BASE + 2);
  });

  it('excludes inactive entries by default', async () => {
    const ids = (await listSpecializations()).map((i) => Number(i.id));
    expect(ids).not.toContain(BASE + 3);
  });

  it('includes inactive entries when asked', async () => {
    const ids = (await listSpecializations({ includeInactive: true })).map((i) => Number(i.id));
    expect(ids).toContain(BASE + 3);
  });

  it('does not mix types', async () => {
    const ids = (await listSpecializations({ includeInactive: true })).map((i) => Number(i.id));

    expect(ids).not.toContain(BASE + 4); // blood group
    expect(ids).not.toContain(BASE + 5); // qualification
  });

  it('reads blood groups through their own helper', async () => {
    const ids = (await listBloodGroups()).map((i) => Number(i.id));
    expect(ids).toContain(BASE + 4);
  });

  it('normalises status to a boolean', async () => {
    const [active] = await listStaticData({
      type: STATIC_DATA_TYPE.SPECIALIZATION,
      includeInactive: true,
    }).then((rows) => rows.filter((r) => Number(r.id) === BASE + 1));

    expect(active.isActive).toBe(true);

    const [inactive] = await listStaticData({
      type: STATIC_DATA_TYPE.SPECIALIZATION,
      includeInactive: true,
    }).then((rows) => rows.filter((r) => Number(r.id) === BASE + 3));

    expect(inactive.isActive).toBe(false);
  });

  it('returns an empty list for an unknown type rather than throwing', async () => {
    expect(await listStaticData({ type: 'no_such_type' })).toEqual([]);
  });
});
