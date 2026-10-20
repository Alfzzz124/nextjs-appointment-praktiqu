/**
 * Owner mode reaches the REAL scope functions: on operational routes the actor is pinned
 * to the owned clinic exactly like its admin; on clinical and configuration routes it is
 * still a professional confined to their own rows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getActor } from '@/lib/auth';
import { readScopeFor } from '@/services/service-catalog/scope';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { doctorSessionScopeFor } from '@/services/billing/staff-scope';
import { billScopeFor } from '@/services/billing/kc-permissions';
import { dashboardScopeFor } from '@/services/billing/schedule-scope';
import { assertTestDb } from '../../billing/fixtures';
import { idBlock } from '../../helpers/id-blocks';

const { GET: settingsGET } = await import('@/app/api/v1/practices/[id]/settings/route');

const { BASE, END } = idBlock('integration/auth/owner-mode-scope.test.ts');
const FIRST = BASE + 1; // DOC's first mapping, shared with OTHER, not owned
const OWNED = BASE + 2; // DOC + OTHER, DOC ticked
const DOC = BASE + 500;
const OTHER = BASE + 501;
const DOC_USER = 'owner-scope-test-doc';
const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function req(path: string, method = 'GET', header: string | null = String(OWNED)): Promise<NextRequest> {
  const jwt = await new SignJWT({ role: 'PROFESSIONAL' })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(DOC_USER).setExpirationTime('1h').sign(SECRET);
  const headers: Record<string, string> = { authorization: `Bearer ${jwt}` };
  if (header !== null) headers['x-praktiqu-clinic-id'] = header;
  return new NextRequest(`http://localhost${path}`, { method, headers });
}

function caps(role: string) { return `a:1:{s:${role.length}:"${role}";b:1;}`; }

async function wipe() {
  await prisma.clinicOwner.deleteMany({ where: { clinicId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcDoctorClinicMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'owner-scope-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  for (const id of [DOC, OTHER]) {
    await prisma.kcUser.create({ data: { id: BigInt(id), userLogin: `os${id}`, userEmail: `os${id}@test.local`, displayName: `Dr ${id}`, userRegistered: new Date() } });
    await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: caps('kiviCare_doctor') } });
  }
  for (const id of [FIRST, OWNED]) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
       VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', 1, 0, 0, NOW())`, id, `Klinik ${id}`, `c${id}@test.local`);
  }
  let m = BASE + 9000;
  for (const [doctorId, clinicId] of [[DOC, FIRST], [OTHER, FIRST], [DOC, OWNED], [OTHER, OWNED]]) {
    m += 1;
    await prisma.kcDoctorClinicMapping.create({ data: { id: BigInt(m), doctorId: BigInt(doctorId), clinicId: BigInt(clinicId), createdAt: new Date() } });
  }
  await prisma.clinicOwner.create({ data: { clinicId: BigInt(OWNED), doctorWpUserId: BigInt(DOC), createdBy: 'test' } });
  await prisma.user.create({
    data: { id: DOC_USER, email: `${DOC_USER}@test.local`, username: DOC_USER, firstName: 'D', lastName: 'R', displayName: 'Dr', role: 'PROFESSIONAL', wpUserId: BigInt(DOC), status: 1 },
  });
});

afterAll(async () => {
  await wipe();
});

describe('operational routes in owner mode', () => {
  it('services: every psychologist of the owned clinic, not just their own rows', async () => {
    const scope = await readScopeFor(await getActor(await req('/api/v1/services')));
    expect(scope).toEqual({ clinicId: BigInt(OWNED), doctorId: null, empty: false });
  });

  it('schedules, bills and dashboard: pinned to the owned clinic, not to the first mapping', async () => {
    const kc = await resolveKcActor(await getActor(await req('/api/v1/professional-sessions/week')));
    expect(kc.clinicId).toBe(BigInt(OWNED));
    expect(doctorSessionScopeFor(kc)).toEqual({ clinicId: BigInt(OWNED) });

    const bills = await resolveKcActor(await getActor(await req('/api/v1/bills')));
    expect(billScopeFor(bills)).toEqual({ clinicId: BigInt(OWNED) });

    const dash = await resolveKcActor(await getActor(await req('/api/v1/dashboard/statistics')));
    expect(dashboardScopeFor(dash)).toEqual({ clinicId: BigInt(OWNED) });
  });

  it('without the header nothing changes: own rows only', async () => {
    const scope = await readScopeFor(await getActor(await req('/api/v1/services', 'GET', null)));
    expect(scope).toEqual({ clinicId: null, doctorId: BigInt(DOC), empty: false });
  });
});

describe('clinical and configuration routes in owner mode', () => {
  it.each(['/api/v1/encounters', '/api/v1/sessions/1/notes', '/api/v1/patient-medical-reports', '/api/v1/clinic-schedules'])(
    '%s keeps a professional confined to their own rows',
    async (path) => {
      const actor = await getActor(await req(path));
      expect(actor.role).toBe('PROFESSIONAL');
      expect(doctorSessionScopeFor(await resolveKcActor(actor))).toEqual({ doctorId: BigInt(DOC) });
    },
  );

  it('clinic settings answer 403, owner or not', async () => {
    const res = await settingsGET(await req(`/api/v1/practices/${OWNED}/settings`), { params: { id: String(OWNED) } });
    expect(res.status).toBe(403);
  });
});
