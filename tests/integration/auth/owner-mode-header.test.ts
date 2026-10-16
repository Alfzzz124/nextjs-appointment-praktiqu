/**
 * X-Praktiqu-Clinic-Id for a PROFESSIONAL: owner mode. Accepted only for a clinic they
 * own; on allowlisted routes the actor becomes that clinic's admin, elsewhere it stays a
 * professional carrying ownerClinicId.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { AuthError, getActor } from '@/lib/auth';
import { assertTestDb } from '../../billing/fixtures';

const BASE = 8_770_000;
const END = BASE + 10_000;
const OWNED = BASE + 1; // solo clinic of DOC
const SHARED = BASE + 2; // DOC + OTHER, nobody ticked
const DOC = BASE + 500;
const OTHER = BASE + 501;
const DOC_USER = 'owner-mode-test-doc';
const RECEPTIONIST_USER = 'owner-mode-test-receptionist';
const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function req(path: string, header?: string, method = 'GET', sub = DOC_USER, role = 'PROFESSIONAL'): Promise<NextRequest> {
  const jwt = await new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
  const headers: Record<string, string> = { authorization: `Bearer ${jwt}` };
  if (header !== undefined) headers['x-praktiqu-clinic-id'] = header;
  return new NextRequest(`http://localhost${path}`, { method, headers });
}

async function rejection(p: Promise<unknown>): Promise<AuthError> {
  try { await p; } catch (err) { if (err instanceof AuthError) return err; throw err; }
  throw new Error('expected getActor to reject');
}

function caps(role: string) { return `a:1:{s:${role.length}:"${role}";b:1;}`; }

async function wipe() {
  await prisma.clinicOwner.deleteMany({ where: { clinicId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcDoctorClinicMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'owner-mode-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  for (const id of [DOC, OTHER]) {
    await prisma.kcUser.create({ data: { id: BigInt(id), userLogin: `om${id}`, userEmail: `om${id}@test.local`, displayName: `Dr ${id}`, userRegistered: new Date() } });
    await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: caps('kiviCare_doctor') } });
  }
  for (const [id, name] of [[OWNED, 'Klinik Milik'], [SHARED, 'Klinik Bersama']] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
       VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', 1, 0, 0, NOW())`, id, name, `c${id}@test.local`);
  }
  let m = BASE + 9000;
  for (const [doctorId, clinicId] of [[DOC, OWNED], [DOC, SHARED], [OTHER, SHARED]]) {
    m += 1;
    await prisma.kcDoctorClinicMapping.create({ data: { id: BigInt(m), doctorId: BigInt(doctorId), clinicId: BigInt(clinicId), createdAt: new Date() } });
  }
  await prisma.user.create({
    data: { id: DOC_USER, email: `${DOC_USER}@test.local`, username: DOC_USER, firstName: 'D', lastName: 'R', displayName: 'Dr', role: 'PROFESSIONAL', wpUserId: BigInt(DOC), status: 1 },
  });
  await prisma.user.create({
    data: { id: RECEPTIONIST_USER, email: `${RECEPTIONIST_USER}@test.local`, username: RECEPTIONIST_USER, firstName: 'R', lastName: 'C', displayName: 'Rc', role: 'RECEPTIONIST', status: 1 },
  });
});

afterAll(async () => {
  await wipe();
});

describe('getActor — PROFESSIONAL with X-Praktiqu-Clinic-Id', () => {
  it('without the header: a plain professional, no owner clinic', async () => {
    const actor = await getActor(await req('/api/v1/services'));
    expect(actor.role).toBe('PROFESSIONAL');
    expect(actor.ownerClinicId).toBeUndefined();
    expect(actor.activeClinicId).toBeUndefined();
  });

  it('owned clinic on an allowlisted route: acts as that clinic admin', async () => {
    const actor = await getActor(await req('/api/v1/services', String(OWNED)));
    expect(actor.role).toBe('CLINIC_ADMIN');
    expect(actor.activeClinicId).toBe(BigInt(OWNED));
    expect(actor.ownerClinicId).toBe(BigInt(OWNED));
  });

  it('owned clinic on a clinical route: stays a professional', async () => {
    const actor = await getActor(await req('/api/v1/encounters', String(OWNED)));
    expect(actor.role).toBe('PROFESSIONAL');
    expect(actor.ownerClinicId).toBe(BigInt(OWNED));
    expect(actor.activeClinicId).toBeUndefined();
  });

  it('a clinic they practise at but do not own: 403 clinic_not_in_scope', async () => {
    const err = await rejection(getActor(await req('/api/v1/services', String(SHARED))));
    expect(err.status).toBe(403);
    expect(err.message).toBe('clinic_not_in_scope');
  });

  it('a clinic that does not exist: the same 403 clinic_not_in_scope', async () => {
    const err = await rejection(getActor(await req('/api/v1/services', String(BASE + 9))));
    expect(err.status).toBe(403);
    expect(err.message).toBe('clinic_not_in_scope');
  });

  it('a receptionist sending the header is unaffected', async () => {
    const actor = await getActor(await req('/api/v1/services', String(OWNED), 'GET', RECEPTIONIST_USER, 'RECEPTIONIST'));
    expect(actor.role).toBe('RECEPTIONIST');
    expect(actor.activeClinicId).toBeUndefined();
    expect(actor.ownerClinicId).toBeUndefined();
  });

  it('a malformed value: 400 invalid_clinic_header', async () => {
    const err = await rejection(getActor(await req('/api/v1/services', '01')));
    expect(err.status).toBe(400);
    expect(err.message).toBe('invalid_clinic_header');
  });

  it('ticking them as owner opens the shared clinic on the next request', async () => {
    await prisma.clinicOwner.create({ data: { clinicId: BigInt(SHARED), doctorWpUserId: BigInt(DOC), createdBy: 'test' } });
    const actor = await getActor(await req('/api/v1/sessions', String(SHARED)));
    expect(actor.role).toBe('CLINIC_ADMIN');
    expect(actor.activeClinicId).toBe(BigInt(SHARED));
  });
});
