// tests/integration/services/duration-options-route.test.ts
/**
 * Duration options end to end: the real routes, a real JWT, and real wp_kc_* rows. The
 * steps build on each other in order, the way an admin would use the form.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { issueAccessToken } from '@/lib/auth/jwt';
import { assertTestDb } from '../../billing/fixtures';
import { idBlock } from '../../helpers/id-blocks';

const item = await import('@/app/api/v1/services/[id]/route');
const collection = await import('@/app/api/v1/services/route');

const { BASE, END } = idBlock('integration/services/duration-options-route.test.ts');
const D = BASE + 500;
const C = BASE + 600;
const S = BASE + 1; // the parent's catalogue row
const S_TAKEN = BASE + 2; // catalogue of a standalone service that will clash on name
const S_NOTE = BASE + 3;
const P = BASE + 101; // the parent mapping
const TAKEN = BASE + 102;
const NOTE = BASE + 103; // free text in extra
const APPT = BASE + 700;
const ASM = BASE + 701;
const SUPER = 'durasi-opsi-test-super';
const PREFIX = `Uji Durasi ${BASE}`;
const TYPE = `uji_durasi_${BASE}`;

let token = '';

async function wipe() {
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_appointment_service_mapping WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_appointments WHERE id >= ? AND id < ?`, BASE, END);
  // Options are inserted by the route with auto-increment ids: find them by doctor.
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_service_doctor_mapping WHERE doctor_id >= ? AND doctor_id < ?`, BASE, END);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_services WHERE name LIKE ? OR (id >= ? AND id < ?)`, `${PREFIX}%`, BASE, END);
  await prisma.logEntry.deleteMany({ where: { userId: { startsWith: 'durasi-opsi-test-' } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'durasi-opsi-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await prisma.kcService.createMany({
    data: [
      { id: BigInt(S), name: `${PREFIX} Konseling`, type: TYPE, price: '425000', category: null, status: 1, createdAt: new Date() },
      { id: BigInt(S_TAKEN), name: `${PREFIX} Konseling Pasangan (120 menit)`, type: TYPE, price: '1', category: null, status: 1, createdAt: new Date() },
      { id: BigInt(S_NOTE), name: `${PREFIX} Bercatatan`, type: TYPE, price: '1', category: null, status: 1, createdAt: new Date() },
    ] as never,
  });
  const map = (id: number, serviceId: number, extra: string | null = null) => ({
    id: BigInt(id), serviceId: BigInt(serviceId), doctorId: BigInt(D), clinicId: BigInt(C), charges: '425000',
    duration: 60, status: 1, isPublic: 1, telemedService: 'no', extra, createdAt: new Date(),
  });
  await prisma.kcServiceDoctorMapping.createMany({
    data: [map(P, S), map(TAKEN, S_TAKEN), map(NOTE, S_NOTE, 'catatan admin: jangan dihapus')] as never,
  });
  await prisma.user.create({
    data: {
      id: SUPER, email: `${SUPER}@test.local`, username: SUPER, firstName: 'S', lastName: 'A',
      displayName: 'S A', role: 'SUPER_ADMIN' as never, wpUserId: BigInt(BASE + 900), status: 1,
    },
  });
  ({ token } = await issueAccessToken({ userId: SUPER, role: 'SUPER_ADMIN', email: `${SUPER}@test.local`, username: SUPER }));
});

afterAll(wipe);

async function call(method: 'GET' | 'PUT' | 'DELETE', id: number, body?: unknown) {
  const req = new NextRequest(`http://localhost/api/v1/services/${id}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await item[method](req, { params: { id: String(id) } });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

async function optionRows() {
  return prisma.$queryRawUnsafe<Array<{ id: bigint; status: number; is_public: number; telemed_service: string; duration: number; extra: string; name: string }>>(
    `SELECT sdm.id, sdm.status, sdm.is_public, sdm.telemed_service, sdm.duration, sdm.extra, s.name
       FROM wp_kc_service_doctor_mapping sdm JOIN wp_kc_services s ON s.id = sdm.service_id
      WHERE sdm.doctor_id = ? AND sdm.extra LIKE ? ORDER BY sdm.id`,
    D, '%praktiqu_duration_of%',
  );
}

let optionId = 0;

describe('duration options through PUT /api/v1/services/{id}', () => {
  it('adds an option that inherits the parent and is named after it', async () => {
    const { status, json } = await call('PUT', P, { durationOptions: [{ duration: 90, price: 600000 }] });

    expect(status).toBe(200);
    expect(json.durationOptions).toHaveLength(1);
    expect(json.durationOptions[0]).toMatchObject({ name: `${PREFIX} Konseling (90 menit)`, durationMinutes: 90, price: 600000, isActive: true });
    optionId = json.durationOptions[0].id;

    const [row] = await optionRows();
    expect(Number(row.id)).toBe(optionId);
    expect(JSON.parse(row.extra)).toEqual({ praktiqu_duration_of: P });
    expect([row.status, row.is_public, row.telemed_service]).toEqual([1, 1, 'no']);
  });

  it('GET of the option names its parent; the flat list carries both', async () => {
    expect((await call('GET', optionId)).json.durationOf).toBe(P);

    const req = new NextRequest(`http://localhost/api/v1/services?professionalId=${D}&perPage=100`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const list = (await (await collection.GET(req, { params: {} } as never)).json()) as Record<string, any>;
    const byId = new Map(list.services.map((s: any) => [s.id, s]));
    expect((byId.get(P) as any).durationOptions.map((o: any) => o.id)).toEqual([optionId]);
    expect((byId.get(optionId) as any).durationOf).toBe(P);
  });

  it('a parent rename renames the option', async () => {
    expect((await call('PUT', P, { name: `${PREFIX} Konseling Pasangan` })).status).toBe(200);
    expect((await optionRows())[0].name).toBe(`${PREFIX} Konseling Pasangan (90 menit)`);
  });

  it('status, visibility and telemed follow the parent', async () => {
    await call('PUT', P, { status: 0, isPublic: 0, telemedService: 'yes' });
    let [row] = await optionRows();
    expect([row.status, row.is_public, row.telemed_service]).toEqual([0, 0, 'yes']);

    await call('PUT', P, { status: 1, isPublic: 1, telemedService: 'no' });
    [row] = await optionRows();
    expect([row.status, row.is_public, row.telemed_service]).toEqual([1, 1, 'no']);
  });

  it('refuses a parent duration equal to an option and changes nothing', async () => {
    const { status, json } = await call('PUT', P, { duration: 90 });
    expect(status).toBe(422);
    expect(json.code).toBe('duration_option_duplicate');
    const parent = await prisma.kcServiceDoctorMapping.findUnique({ where: { id: BigInt(P) }, select: { duration: true } });
    expect(parent!.duration).toBe(60);
  });

  it('refuses a fifth extra duration', async () => {
    const durationOptions = [30, 45, 90, 120, 150].map((duration) => ({ duration, price: 1 }));
    expect((await call('PUT', P, { durationOptions })).json.code).toBe('duration_option_limit');
  });

  it('refuses to edit or delete the option row directly', async () => {
    expect((await call('PUT', optionId, { price: 1 })).json.code).toBe('edit_via_parent');
    expect((await call('DELETE', optionId)).json.code).toBe('edit_via_parent');
  });

  it('refuses an option name another service of this professional already has, inserting nothing', async () => {
    const { status } = await call('PUT', P, {
      durationOptions: [{ id: optionId, duration: 90, price: 600000 }, { duration: 120, price: 800000 }],
    });
    expect(status).toBe(409);
    expect(await optionRows()).toHaveLength(1);
  });

  it('will not remove an option an upcoming booking uses, then will once it is cancelled', async () => {
    const [{ service_id: optionServiceId }] = await prisma.$queryRawUnsafe<Array<{ service_id: bigint }>>(
      `SELECT service_id FROM wp_kc_service_doctor_mapping WHERE id = ?`, optionId,
    );
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_appointments
         (id, clinic_id, doctor_id, patient_id, appointment_start_date, appointment_start_time,
          appointment_end_date, appointment_end_time, appointment_timezone, visit_type, description, status, created_at)
       VALUES (?, ?, ?, ?, ?, '10:00:00', ?, '11:30:00', 'Asia/Jakarta', '', '', 1, NOW())`,
      APPT, C, D, BASE + 800, tomorrow, tomorrow,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_appointment_service_mapping (id, appointment_id, service_id, status, created_at) VALUES (?, ?, ?, 1, NOW())`,
      ASM, APPT, optionServiceId,
    );

    const refused = await call('PUT', P, { durationOptions: [] });
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('duration_option_has_appointments');
    expect(refused.json.count).toBe(1);

    await prisma.$executeRawUnsafe(`UPDATE wp_kc_appointments SET status = 0 WHERE id = ?`, APPT);

    const ok = await call('PUT', P, { durationOptions: [] });
    expect(ok.status).toBe(200);
    expect(ok.json.durationOptions).toEqual([]);
    const [row] = await optionRows();
    expect(row.status).toBe(0);
    expect(JSON.parse(row.extra)).toEqual({ praktiqu_duration_of_removed: P });
  });

  it('re-adding a removed duration is not a name clash', async () => {
    const { status, json } = await call('PUT', P, { durationOptions: [{ duration: 90, price: 610000 }] });
    expect(status).toBe(200);
    expect(json.durationOptions.map((o: any) => [o.durationMinutes, o.price])).toEqual([[90, 610000]]);
  });

  it('never touches a row whose extra holds someone else\'s text', async () => {
    expect((await call('PUT', NOTE, { price: 1 })).status).toBe(200);
    const row = await prisma.kcServiceDoctorMapping.findUnique({ where: { id: BigInt(NOTE) }, select: { extra: true } });
    expect(row!.extra).toBe('catatan admin: jangan dihapus');
  });

  it('deleting the parent retires its live option too', async () => {
    expect((await call('DELETE', P)).status).toBe(200);
    const live = (await optionRows()).filter((r) => JSON.parse(r.extra).praktiqu_duration_of === P);
    expect(live.map((r) => r.status)).toEqual([0]);
  });
});
