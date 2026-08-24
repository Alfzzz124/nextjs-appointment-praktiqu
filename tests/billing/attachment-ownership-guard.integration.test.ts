/**
 * Proves the sessions/:id/attachments/:mediaId/content route actually consults
 * `attachmentBelongsToAppointment` — not just that the repository function is
 * correct in isolation (see tests/repositories/wp-encounter-documents.repo.test.ts),
 * but that the ROUTE is wired to call it.
 *
 * Before this test existed, a reviewer patched `attachmentBelongsToAppointment`
 * to always return `true` and every existing integration test for this route
 * still passed. That guard is what stops a caller holding one legitimate
 * session from reading another appointment's clinical documents by
 * incrementing an integer.
 *
 * This uses real rows in the test database rather than mocking `@/lib/db` (as
 * the sibling suite in encounter-documents-routes.integration.test.ts does).
 * The scenario needs `kcAppointment`-adjacent raw SQL reads for TWO different
 * appointment ids from TWO different call sites (the guard itself, and
 * `listBookingAttachments`, both keyed off different ids in this flow) — faking
 * that correctly would mean re-encoding the guard's own logic into the mock,
 * which risks the mock being "right" for the wrong reason and proving nothing
 * about the real code path. Seeding is the honest option here.
 *
 * The response message is asserted precisely, not just the status code: with
 * the guard bypassed, the route still returns 404 — but for an unrelated
 * reason ("Attachment file is no longer available", from the
 * `listBookingAttachments` lookup finding no matching id in the caller's OWN
 * appointment_report). Asserting only `toBe(404)` would not fail if the guard
 * were deleted; asserting the exact "Attachment not found" message does.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from './fixtures';
import { GET as attachmentGET } from '@/app/api/v1/sessions/[id]/attachments/[mediaId]/content/route';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

// Own id range for wp_kc_appointments — distinct from every other suite's.
// See the range table in tests/billing/fixtures.ts and the BASE comment in
// tests/repositories/wp-encounter-documents.repo.test.ts (which owns
// 8,800,000-8,900,000). wp-static-data owns 8,900,000-9,000,000 but in a
// different table (wp_kc_static_data), and TEST_MARKER (9,000,000+, also
// wp_kc_appointments via billing/fixtures.ts's seedAppointment) starts right
// after this suite's END.
const BASE = 8_950_000;
const END = BASE + 10_000;

const APPOINTMENT_OWNER = BASE + 1; // owns MEDIA_ID in its appointment_report
const APPOINTMENT_ATTACKER = BASE + 2; // the caller's own, legitimate session — does not own MEDIA_ID
const MEDIA_ID = BASE + 100;

const ACTOR_ID = 'test-attachment-guard-actor';
const ACTOR_WP_USER_ID = BASE + 900;

async function token() {
  return new SignJWT({ role: 'SUPER_ADMIN' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(ACTOR_ID)
    .setExpirationTime('1h')
    .sign(SECRET);
}

function reqWith(jwt: string, url: string) {
  return new NextRequest(url, { headers: { authorization: `Bearer ${jwt}` } });
}

async function seedAppointment(id: number, report: string) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_appointments
       (id, appointment_start_date, appointment_start_time, appointment_end_date,
        appointment_end_time, visit_type, clinic_id, doctor_id, patient_id, description,
        status, created_at, appointment_report)
     VALUES (?, CURDATE(), '09:00:00', CURDATE(), '10:00:00', '1', 1, 1, 1, '', 1, NOW(), ?)`,
    id, report,
  );
}

async function wipe() {
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_appointments WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.user.deleteMany({ where: { id: ACTOR_ID } });
}

describe('GET /sessions/:id/attachments/:mediaId/content — ownership guard wiring', () => {
  beforeAll(async () => {
    assertTestDb();
    await wipe();

    await seedAppointment(APPOINTMENT_OWNER, JSON.stringify([MEDIA_ID]));
    await seedAppointment(APPOINTMENT_ATTACKER, '[]');

    await prisma.user.create({
      data: {
        id: ACTOR_ID,
        email: `${ACTOR_ID}@test.local`,
        username: ACTOR_ID,
        firstName: 'Guard',
        lastName: 'Test',
        displayName: 'Guard Test',
        role: 'SUPER_ADMIN',
        wpUserId: BigInt(ACTOR_WP_USER_ID),
        status: 1,
      },
    });
  });

  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  it('refuses a media id that belongs to a different appointment than the one in the URL (404)', async () => {
    const res = await attachmentGET(
      reqWith(
        await token(),
        `http://localhost/api/v1/sessions/${APPOINTMENT_ATTACKER}/attachments/${MEDIA_ID}/content`,
      ),
      { params: { id: String(APPOINTMENT_ATTACKER), mediaId: String(MEDIA_ID) } } as any,
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.message).toBe('Attachment not found');
  });
});
