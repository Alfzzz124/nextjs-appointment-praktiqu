/**
 * DELETE /api/v1/practices/:id?permanent=true — only a clinic with no data at all can be
 * deleted; anything else answers 409 with what it still has, and stays.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { clinicPaymentOptionName } from '@/repositories/wp/clinic-payment-settings.repo';
import { DELETE } from '@/app/api/v1/practices/[id]/route';
import { idBlock } from '../../helpers/id-blocks';

const { BASE, END } = idBlock('integration/practice/practice-delete-permanent.test.ts');
const EMPTY = BASE + 1;
const BUSY = BASE + 2;
const MISSING = BASE + 9;
const DOCTOR = BASE + 600;
const SUPER = 'crud-delete-test-super';
const ADMIN_AUTH = 'crud-delete-test-admin';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
const token = (sub: string, role: string) =>
  new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);

async function remove(sub: string, role: string, id: number, query = '?permanent=true') {
  const req = new NextRequest(`http://localhost/api/v1/practices/${id}${query}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${await token(sub, role)}` },
  });
  return DELETE(req, { params: { id: String(id) } });
}

const exists = async (id: number) => (await prisma.kcClinic.count({ where: { id: BigInt(id) } })) === 1;

async function wipe() {
  for (const id of [EMPTY, BUSY]) {
    await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinic_schedule WHERE module_type = 'clinic' AND module_id = ?`, id);
    await prisma.$executeRawUnsafe(`DELETE FROM wp_options WHERE option_name = ?`, clinicPaymentOptionName(id));
  }
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_doctor_clinic_mappings WHERE doctor_id = ?`, DOCTOR);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.logEntry.deleteMany({ where: { userId: { in: [SUPER, ADMIN_AUTH] } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'crud-delete-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  for (const id of [EMPTY, BUSY]) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinics (id, name, status, clinic_admin_id, clinic_logo, created_at) VALUES (?, ?, 1, 0, 0, NOW())`,
      id,
      `Klinik Uji Hapus 8640 ${id}`,
    );
  }
  // EMPTY has a holiday and a payment option — neither counts as "data", both go with it.
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinic_schedule (start_date, end_date, module_type, module_id, description, status, created_at)
     VALUES ('2026-12-25', '2026-12-25', 'clinic', ?, 'Natal', 1, NOW())`,
    EMPTY,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_options (option_name, option_value, autoload) VALUES (?, '{}', 'no')`,
    clinicPaymentOptionName(EMPTY),
  );
  // BUSY has a psychologist.
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_doctor_clinic_mappings (doctor_id, clinic_id, owner, created_at) VALUES (?, ?, 0, NOW())`,
    DOCTOR,
    BUSY,
  );
  for (const [id, role] of [[SUPER, 'SUPER_ADMIN'], [ADMIN_AUTH, 'CLINIC_ADMIN']] as const) {
    await prisma.user.create({
      data: {
        id, email: `${id}@test.local`, username: id, firstName: 'T', lastName: 'U', displayName: 'Test',
        role, wpUserId: role === 'CLINIC_ADMIN' ? BigInt(BASE + 500) : null, status: 1,
      },
    });
  }
});

afterAll(async () => {
  await wipe();
});

describe('DELETE ?permanent=true', () => {
  it('403s a clinic admin', async () => {
    expect((await remove(ADMIN_AUTH, 'CLINIC_ADMIN', EMPTY)).status).toBe(403);
    expect(await exists(EMPTY)).toBe(true);
  });

  it('409s a clinic that still has data, listing only what it has', async () => {
    const res = await remove(SUPER, 'SUPER_ADMIN', BUSY);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('clinic_not_empty');
    expect(body.counts).toEqual({ doctors: 1 });
    expect(await exists(BUSY)).toBe(true);
  });

  it('deletes an empty clinic with its holidays and payment option, audited', async () => {
    const res = await remove(SUPER, 'SUPER_ADMIN', EMPTY);
    expect(res.status).toBe(204);
    expect(await exists(EMPTY)).toBe(false);
    const [holidays] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*) AS n FROM wp_kc_clinic_schedule WHERE module_type = 'clinic' AND module_id = ?`,
      EMPTY,
    );
    expect(Number(holidays.n)).toBe(0);
    expect(await prisma.kcOption.count({ where: { optionName: clinicPaymentOptionName(EMPTY) } })).toBe(0);

    const audit = await prisma.logEntry.findFirst({ where: { action: 'practice.delete', resourceId: String(EMPTY) } });
    expect(audit).toMatchObject({ userId: SUPER, resource: 'clinic' });
    expect(audit!.metadata).toMatchObject({ name: `Klinik Uji Hapus 8640 ${EMPTY}`, clinicAdminId: 0 });
  });

  it('404s a clinic that does not exist', async () => {
    expect((await remove(SUPER, 'SUPER_ADMIN', MISSING)).status).toBe(404);
  });

  it('without ?permanent=true still only deactivates', async () => {
    expect((await remove(SUPER, 'SUPER_ADMIN', BUSY, '')).status).toBe(204);
    expect(await exists(BUSY)).toBe(true);
    expect((await prisma.kcClinic.findUnique({ where: { id: BigInt(BUSY) } }))!.status).toBe(0);
  });
});
