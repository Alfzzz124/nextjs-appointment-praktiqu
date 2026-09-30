/**
 * GET /api/v1/public/professionals/{id} and /public/professionals/by-slug/{slug}.
 *
 * The Laravel FE resolved personal links (terpadu.praktiqu.com/{slug}) by scanning the
 * public directory, which returns the 50 lowest ids. Every professional past the 50th was
 * a 404. These two endpoints find one professional directly.
 *
 * Runs against the real test database: the lookup is a raw SQL scan over wp_users and
 * wp_usermeta, and a mock would only restate what the query was assumed to return. The
 * repositories are wrapped, not replaced, so the tests can also check the by-slug scan
 * stays cheap.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';

vi.mock('@/repositories/wp/doctors.repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/repositories/wp/doctors.repo')>();
  return {
    ...actual,
    findDoctorById: vi.fn(actual.findDoctorById),
    listDoctorNames: vi.fn(actual.listDoctorNames),
    listDoctors: vi.fn(actual.listDoctors),
  };
});
vi.mock('@/repositories/wp/clinic-sessions.repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/repositories/wp/clinic-sessions.repo')>();
  return { ...actual, listClinicSessions: vi.fn(actual.listClinicSessions) };
});

import { GET as listGET } from '@/app/api/v1/public/professionals/route';
import { GET as byIdGET } from '@/app/api/v1/public/professionals/[id]/route';
import { GET as bySlugGET } from '@/app/api/v1/public/professionals/by-slug/[slug]/route';
import { findDoctorById, listDoctorNames, listDoctors } from '@/repositories/wp/doctors.repo';
import { listClinicSessions } from '@/repositories/wp/clinic-sessions.repo';

/** Test-owned range, inside this suite's allocation (8_800_000 – 8_849_999). */
const BASE = 8_830_000;
const END = BASE + 10_000;

/** Fifty active doctors below every other seed, so TARGET is at least 51st in the list. */
const FILLERS = Array.from({ length: 50 }, (_, i) => BASE + 1 + i);
const TARGET = BASE + 100;
const UNICODE = BASE + 101;
const INACTIVE_TWIN = BASE + 102;
const TWIN_A = BASE + 103;
const TWIN_B = BASE + 104;
const INACTIVE = BASE + 105;
const PENDING = BASE + 106;
const DISPLAY_ONLY = BASE + 107;
const NOT_A_DOCTOR = BASE + 108;
const CLINIC = BASE + 500;

function capabilities(role: string): string {
  return `a:1:{s:${role.length}:"${role}";b:1;}`;
}

type Seed = {
  id: number;
  displayName?: string;
  first?: string;
  last?: string;
  status?: string;
  role?: string;
  extra?: Record<string, string>;
};

async function seedUser(seed: Seed) {
  await prisma.kcUser.create({
    data: {
      id: BigInt(seed.id),
      userLogin: `lookup${seed.id}`,
      userEmail: `lookup${seed.id}@test.local`,
      displayName: seed.displayName ?? `Display ${seed.id}`,
      userRegistered: new Date('2026-01-01T00:00:00Z'),
    },
  });
  const meta: Array<{ metaKey: string; metaValue: string }> = [
    { metaKey: 'wp_capabilities', metaValue: capabilities(seed.role ?? 'kiviCare_doctor') },
  ];
  if (seed.first !== undefined) meta.push({ metaKey: 'first_name', metaValue: seed.first });
  if (seed.last !== undefined) meta.push({ metaKey: 'last_name', metaValue: seed.last });
  if (seed.status !== undefined) {
    meta.push({ metaKey: 'praktiqu_professional_status', metaValue: seed.status });
  }
  for (const [metaKey, metaValue] of Object.entries(seed.extra ?? {})) {
    meta.push({ metaKey, metaValue });
  }
  await prisma.kcUserMeta.createMany({
    data: meta.map((m) => ({ userId: BigInt(seed.id), ...m })),
  });
}

async function wipe() {
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_clinic_sessions WHERE doctor_id >= ? AND doctor_id < ?`,
    BASE,
    END,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_doctor_clinic_mappings WHERE doctor_id >= ? AND doctor_id < ?`,
    BASE,
    END,
  );
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();

  for (const [i, id] of FILLERS.entries()) {
    // Alternate explicit ACTIVE with no status meta at all — a KiviCare-created doctor
    // has none, and reads as ACTIVE.
    await seedUser({ id, first: 'Pengisi', last: `Nomor ${i + 1}`, status: i % 2 ? 'ACTIVE' : undefined });
  }

  await seedUser({
    id: TARGET,
    first: 'Dianda',
    last: 'Azani, M.Psi., Psikolog',
    status: 'ACTIVE',
    extra: {
      doctor_description: 'Psikolog klinis dewasa',
      praktiqu_professional_type: 'PSIKOLOG_KLINIS',
      basic_data: JSON.stringify({ specialties: [{ id: 1, label: 'Kecemasan' }] }),
    },
  });
  await seedUser({ id: UNICODE, first: 'İlham', last: 'Çelik', status: 'ACTIVE' });
  await seedUser({ id: INACTIVE_TWIN, first: 'Sama', last: 'Nama', status: 'INACTIVE' });
  await seedUser({ id: TWIN_A, first: 'Sama', last: 'Nama', status: 'ACTIVE' });
  await seedUser({ id: TWIN_B, first: 'Sama-Nama', status: 'ACTIVE' });
  await seedUser({ id: INACTIVE, first: 'Tidak', last: 'Aktif', status: 'INACTIVE' });
  await seedUser({ id: PENDING, first: 'Belum', last: 'Aktif', status: 'PENDING_ACTIVATION' });
  await seedUser({ id: DISPLAY_ONLY, displayName: 'Dr. Tanpa Meta', status: 'ACTIVE' });
  await seedUser({ id: NOT_A_DOCTOR, first: 'Bukan', last: 'Dokter', role: 'kiviCare_patient' });

  // TARGET alone at CLINIC, so the directory filtered to CLINIC yields TARGET's entry as
  // the list computes it — the reference the single lookups must equal.
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_doctor_clinic_mappings (doctor_id, clinic_id, created_at) VALUES (?, ?, NOW())`,
    TARGET,
    CLINIC,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinic_sessions (clinic_id, doctor_id, day, start_time, end_time, time_slot, created_at)
     VALUES (?, ?, 'mon', '09:00:00', '12:00:00', 60, NOW())`,
    CLINIC,
    TARGET,
  );
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.mocked(findDoctorById).mockClear();
  vi.mocked(listDoctorNames).mockClear();
  vi.mocked(listDoctors).mockClear();
  vi.mocked(listClinicSessions).mockClear();
});

function req(path: string) {
  return new NextRequest(`http://localhost/api/v1/public/professionals${path}`);
}

async function byId(id: string) {
  return byIdGET(req(`/${id}`), { params: { id } });
}

async function bySlug(slug: string) {
  return bySlugGET(req(`/by-slug/${slug}`), { params: { slug } });
}

async function listEntry(id: number, query = '') {
  const body = await (await listGET(req(query))).json();
  return (body.items as Array<{ id: number }>).find((p) => p.id === id);
}

async function expectNotFound(res: Response) {
  expect(res.status).toBe(404);
  expect(res.headers.get('content-type')).toContain('application/problem+json');
  expect((await res.json()).code).toBe('professional_not_found');
}

describe('the bug these endpoints exist for', () => {
  it('TARGET is past the directory’s 50, so the FE’s scan could never find it', async () => {
    const body = await (await listGET(req(''))).json();
    expect(body.items).toHaveLength(50);
    expect(await listEntry(TARGET)).toBeUndefined();
  });
});

describe('GET /public/professionals/{id}', () => {
  it('returns a professional beyond the 50th, exactly as the directory would list them', async () => {
    const res = await byId(String(TARGET));
    expect(res.status).toBe(200);
    const { data } = await res.json();

    const listed = await listEntry(TARGET, `?clinicId=${CLINIC}`);
    expect(listed).toBeDefined();
    expect(data).toEqual(listed);

    expect(data.fullName).toBe('Dianda Azani, M.Psi., Psikolog');
    expect(data.specialties).toEqual(['Kecemasan']);
    expect(data.nextAvailable.startTime).toBe('09:00:00');
  });

  it('404s an inactive, pending, unknown or non-doctor id', async () => {
    await expectNotFound(await byId(String(INACTIVE)));
    await expectNotFound(await byId(String(PENDING)));
    await expectNotFound(await byId(String(BASE + 999)));
    await expectNotFound(await byId(String(NOT_A_DOCTOR)));
  });

  it('404s anything that is not a positive integer, without querying', async () => {
    for (const id of ['0', '-1', 'abc', '1.5', '1e3', '0x10', ' 7', '', 'by-slug']) {
      await expectNotFound(await byId(id));
    }
    expect(findDoctorById).not.toHaveBeenCalled();
  });
});

describe('GET /public/professionals/by-slug/{slug}', () => {
  it('resolves a name with titles and punctuation, beyond the 50th', async () => {
    const res = await bySlug('dianda-azani-m-psi-psikolog');
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toEqual(await listEntry(TARGET, `?clinicId=${CLINIC}`));
  });

  it('builds the full entry only for the match', async () => {
    await bySlug('dianda-azani-m-psi-psikolog');

    // One name scan, then one detail read and one session read — never the directory's
    // heavy query, and never sessions for anyone but the match.
    expect(listDoctorNames).toHaveBeenCalledTimes(1);
    expect(listDoctors).not.toHaveBeenCalled();
    expect(findDoctorById).toHaveBeenCalledTimes(1);
    expect(findDoctorById).toHaveBeenCalledWith(BigInt(TARGET));
    expect(listClinicSessions).toHaveBeenCalledTimes(1);
    expect(listClinicSessions).toHaveBeenCalledWith({ doctorId: BigInt(TARGET) });
  });

  it('normalises the incoming slug the same way', async () => {
    const res = await bySlug('Dianda-Azani--M.Psi.-Psikolog-');
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(TARGET);
  });

  it('matches non-ASCII names the way the FE’s byte-wise slugify does', async () => {
    // PHP's strtolower folds only A–Z and the regex runs on bytes, so 'İ' and 'Ç' become
    // dashes: the FE links "İlham Çelik" as /lham-elik.
    const res = await bySlug('lham-elik');
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.id).toBe(UNICODE);
    expect(data.fullName).toBe('İlham Çelik');

    // Neither a transliteration nor JavaScript's Unicode lowercasing is the FE's link.
    await expectNotFound(await bySlug('ilham-celik'));
    await expectNotFound(await bySlug('i-lham-elik'));
  });

  it('picks the lowest active id when names collide, skipping an inactive lower one', async () => {
    const res = await bySlug('sama-nama');
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(TWIN_A);
  });

  it('falls back to the display name, as the directory does', async () => {
    const res = await bySlug('dr-tanpa-meta');
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.id).toBe(DISPLAY_ONLY);
    expect(data.fullName).toBe('Dr. Tanpa Meta');
  });

  it('404s an inactive, pending, non-doctor or unknown name', async () => {
    await expectNotFound(await bySlug('tidak-aktif'));
    await expectNotFound(await bySlug('belum-aktif'));
    await expectNotFound(await bySlug('bukan-dokter'));
    await expectNotFound(await bySlug('tidak-ada-orangnya-8830000'));
  });

  it('404s a slug that normalises to nothing, without scanning', async () => {
    for (const slug of ['', '---', '%%', 'Ñ']) {
      await expectNotFound(await bySlug(slug));
    }
    expect(listDoctorNames).not.toHaveBeenCalled();
  });
});
