/**
 * Duration options on the real test DB: the marker in `extra` decides which rows are
 * options, and an option never outlives (or out-shows) its parent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../billing/fixtures';
import { idBlock } from '../helpers/id-blocks';
import { optionMarker, removedMarker } from '@/repositories/wp/duration-option-marker';
import {
  findMappingById,
  listClinicServices,
  listOptionRowsOf,
  listServicesForDoctor,
} from '@/repositories/wp/services.repo';

const { BASE, END } = idBlock('repositories/wp-duration-options.repo.test.ts');
const D = BASE + 500; // doctor of the main group
const D2 = BASE + 501; // doctor whose parent is not public
const C = BASE + 600;

// Catalogue rows
const S_PARENT = BASE + 1;
const S_OPT = BASE + 2;
const S_ORPHAN = BASE + 3;
const S_Q = BASE + 4;
const S_QOPT = BASE + 5;
const S_NOTE = BASE + 6;
const S_REMOVED = BASE + 7;
const S_P2 = BASE + 8;
const S_O2 = BASE + 9;

// Mapping rows
const P = BASE + 101; // active parent, 60′
const O = BASE + 102; // live option of P, 90′
const ORPHAN = BASE + 103; // live marker pointing at a mapping that does not exist
const Q = BASE + 104; // inactive parent
const QO = BASE + 105; // ACTIVE option of inactive Q — inconsistent on purpose
const NOTE = BASE + 106; // free text in extra: an ordinary service
const REMOVED = BASE + 107; // removed option of P (status 0)
const P2 = BASE + 108; // parent, not public
const O2 = BASE + 109; // public option of P2

const svc = (id: number, name: string) => ({
  id: BigInt(id), name, type: `uji_${BASE}`, price: '0', category: null, status: 1, createdAt: new Date(),
});
const map = (
  id: number, serviceId: number, doctorId: number,
  o: Partial<{ status: number; isPublic: number; duration: number; charges: string; extra: string | null }> = {},
) => ({
  id: BigInt(id), serviceId: BigInt(serviceId), doctorId: BigInt(doctorId), clinicId: BigInt(C),
  charges: o.charges ?? '425000', duration: o.duration ?? 60, status: o.status ?? 1,
  isPublic: o.isPublic ?? 1, telemedService: 'no', extra: o.extra ?? null, createdAt: new Date(),
});

async function wipe() {
  await prisma.kcServiceDoctorMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcService.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await prisma.kcService.createMany({
    data: [
      svc(S_PARENT, 'Konseling Uji'), svc(S_OPT, 'Konseling Uji (90 menit)'), svc(S_ORPHAN, 'Yatim Uji'),
      svc(S_Q, 'Terapi Uji'), svc(S_QOPT, 'Terapi Uji (90 menit)'), svc(S_NOTE, 'Layanan Bercatatan'),
      svc(S_REMOVED, 'Konseling Uji (120 menit)'), svc(S_P2, 'Privat Uji'), svc(S_O2, 'Privat Uji (90 menit)'),
    ] as never,
  });
  await prisma.kcServiceDoctorMapping.createMany({
    data: [
      map(P, S_PARENT, D),
      map(O, S_OPT, D, { duration: 90, charges: '600000', extra: optionMarker(BigInt(P)) }),
      map(ORPHAN, S_ORPHAN, D, { extra: optionMarker(BigInt(BASE + 999)) }),
      map(Q, S_Q, D, { status: 0 }),
      map(QO, S_QOPT, D, { duration: 90, extra: optionMarker(BigInt(Q)) }),
      map(NOTE, S_NOTE, D, { extra: 'catatan admin: jangan dihapus' }),
      map(REMOVED, S_REMOVED, D, { duration: 120, status: 0, extra: removedMarker(BigInt(P)) }),
      map(P2, S_P2, D2, { isPublic: 0 }),
      map(O2, S_O2, D2, { duration: 90, extra: optionMarker(BigInt(P2)) }),
    ] as never,
  });
});

afterAll(wipe);

const ids = (rows: Array<{ mappingId?: bigint; id?: bigint }>) =>
  rows.map((r) => Number(r.mappingId ?? r.id)).sort((a, b) => a - b);

describe('listServicesForDoctor', () => {
  it('keeps a live option beside its parent and drops stranded ones', async () => {
    const rows = await listServicesForDoctor({ doctorId: BigInt(D) });

    // ORPHAN: parent does not exist. QO: parent inactive, so not in the result.
    expect(ids(rows)).toEqual([P, O, NOTE]);
    expect(rows.find((r) => Number(r.mappingId) === O)!.durationOf).toBe(BigInt(P));
    expect(rows.find((r) => Number(r.mappingId) === O)!.durationMinutes).toBe(90);
    expect(rows.find((r) => Number(r.mappingId) === NOTE)!.durationOf).toBeNull();
  });

  it('hides a public option whose parent is not public', async () => {
    expect(ids(await listServicesForDoctor({ doctorId: BigInt(D2), publicOnly: true }))).toEqual([]);
    expect(ids(await listServicesForDoctor({ doctorId: BigInt(D2) }))).toEqual([P2, O2]);
  });
});

describe('listClinicServices', () => {
  it('lists options flat with their marker, without stranded ones', async () => {
    const page = await listClinicServices({ page: 1, perPage: 100, doctorId: BigInt(D), includeInactive: true });

    // ORPHAN (no parent) and QO (active under an inactive parent) are hidden.
    expect(ids(page.items)).toEqual([P, O, Q, NOTE, REMOVED]);
    expect(page.items.find((r) => Number(r.id) === O)!.optionOf).toEqual({ parentId: BigInt(P), removed: false });
    expect(page.items.find((r) => Number(r.id) === REMOVED)!.optionOf).toEqual({ parentId: BigInt(P), removed: true });
    expect(page.items.find((r) => Number(r.id) === NOTE)!.optionOf).toBeNull();
  });

  it('checks the parent by id, so an option on a later page than its parent survives', async () => {
    // Active rows of D in id order: P, O, ORPHAN, QO, NOTE. Page 2 of size 1 is O alone.
    const page = await listClinicServices({ page: 2, perPage: 1, doctorId: BigInt(D) });
    expect(ids(page.items)).toEqual([O]);
  });
});

describe('listOptionRowsOf', () => {
  it('returns live and removed options of the given parents, shortest first', async () => {
    const rows = await listOptionRowsOf([BigInt(P)]);
    expect(rows.map((r) => Number(r.id))).toEqual([O, REMOVED]);
    expect(rows.map((r) => r.name)).toEqual(['Konseling Uji (90 menit)', 'Konseling Uji (120 menit)']);
  });

  it('returns nothing for no parents', async () => {
    expect(await listOptionRowsOf([])).toEqual([]);
  });
});

describe('findMappingById', () => {
  it('carries the marker', async () => {
    expect((await findMappingById(BigInt(O)))!.optionOf).toEqual({ parentId: BigInt(P), removed: false });
  });
});
