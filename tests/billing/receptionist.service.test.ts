import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb, seedClinicAdmin, cleanup } from './fixtures';

/**
 * Stand in for the WordPress plugin.
 *
 * createReceptionist now provisions through POST /praktiqu/v1/receptionists, because
 * the old raw-SQL path wrote an invalid password hash and skipped kc_receptionist_save
 * — leaving every receptionist locked out and un-emailed. There is no WordPress here,
 * so this mock performs the row writes the plugin would, letting the get/list/scope/
 * status/delete assertions below keep exercising our own read and scoping logic.
 *
 * It deliberately does NOT reproduce the old placeholder hash: wp_insert_user stores a
 * real one, and nothing in these tests should depend on the broken behaviour.
 */
vi.mock('@/repositories/wp/receptionists.write', () => ({
  createReceptionistViaPlugin: vi.fn(async (input: { name: string; email: string; clinicId: number }) => {
    const { prisma: db } = await import('@/lib/db');
    const username = input.email.split('@')[0].slice(0, 60);
    const first = input.name.split(' ')[0];
    const last = input.name.split(' ').slice(1).join(' ') || '-';

    return db.$transaction(async (tx) => {
      // Explicit id inside the fixtures' TEST_MARKER range. Letting AUTO_INCREMENT
      // assign one produces a low id that cleanup() — bounded to that range — cannot
      // find, so rows survive the run and the next one fails on a duplicate email.
      const idRow = await tx.$queryRawUnsafe<any[]>(
        `SELECT COALESCE(MAX(ID), ?) + 1 AS id FROM wp_users WHERE ID >= ? AND ID < ?`,
        9_000_100, 9_000_100, 9_100_000,
      );
      const wpId = Number(idRow[0].id);
      await tx.$executeRawUnsafe(
        `INSERT INTO wp_users (ID, user_login, user_pass, user_nicename, display_name, user_email, user_url, user_registered, user_activation_key, user_status)
         VALUES (?, ?, ?, ?, ?, ?, '', NOW(), '', 0)`,
        wpId, username, '$P$BvalidLookingHashForTestsOnly1234567', username, input.name, input.email,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES
         (?, 'first_name', ?), (?, 'last_name', ?),
         (?, 'wp_capabilities', 'a:1:{s:21:"kiviCare_receptionist";b:1;}'),
         (?, 'wp_user_level', '0')`,
        wpId, first, wpId, last, wpId, wpId,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO wp_kc_receptionist_clinic_mappings (receptionist_id, clinic_id, created_at) VALUES (?, ?, NOW())`,
        wpId, input.clinicId,
      );
      return { id: wpId, email: input.email, clinicId: input.clinicId };
    });
  }),
}));
import {
  createReceptionist, getReceptionist, listReceptionists,
  bulkSetReceptionistStatus, deleteReceptionist,
} from '@/services/billing/receptionist.service';

const CLINIC = 9_000_001, ADMIN = 9_000_002, OTHER_CLINIC = 9_000_003;

// A CLINIC_ADMIN actor scoped to CLINIC — createReceptionist derives clinicId from kc.clinicId.
const kcAdmin = {
  actor: { id: 'test-admin-9000002', role: 'CLINIC_ADMIN', practiceId: null },
  wpUserId: BigInt(ADMIN),
  clinicId: BigInt(CLINIC),
} as any;

const scopeClinic = { clinicId: BigInt(CLINIC) };
const scopeOther = { clinicId: BigInt(OTHER_CLINIC) };

describe('receptionist.service', () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedClinicAdmin({ userId: ADMIN, clinicId: CLINIC });
  });
  afterAll(cleanup);

  it('creates a receptionist, provisions the WP capability, and reads it back within scope', async () => {
    const { id } = await createReceptionist(
      { name: 'Reception One', email: 'reception.one@test.local' },
      kcAdmin,
    );
    expect(id).toBeGreaterThan(0);

    // get + list find it within the clinic scope
    const got = await getReceptionist(id, scopeClinic);
    expect(got.email).toBe('reception.one@test.local');
    expect(got.display_name).toBe('Reception One');

    const list = await listReceptionists({ page: 1, perPage: 100 } as any, scopeClinic);
    expect(list.receptionists.some((r) => r.id === id)).toBe(true);

    // The serialized capability string must be EXACTLY this (kiviCare_receptionist = 21 chars).
    const capRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT meta_value FROM wp_usermeta WHERE user_id = ? AND meta_key = 'wp_capabilities'`, id,
    );
    expect(capRows[0]?.meta_value).toBe('a:1:{s:21:"kiviCare_receptionist";b:1;}');
  });

  it('scopes reads: a different clinic scope cannot see the receptionist', async () => {
    const { id } = await createReceptionist(
      { name: 'Reception Two', email: 'reception.two@test.local' },
      kcAdmin,
    );
    await expect(getReceptionist(id, scopeOther)).rejects.toThrow();
    // owning-clinic scope still sees it
    expect((await getReceptionist(id, scopeClinic)).id).toBe(id);
  });

  it('bulkSetReceptionistStatus flips user_status', async () => {
    const { id } = await createReceptionist(
      { name: 'Reception Three', email: 'reception.three@test.local' },
      kcAdmin,
    );
    expect((await getReceptionist(id, scopeClinic)).status).toBe(0);

    const n = await bulkSetReceptionistStatus([id], 1, scopeClinic);
    expect(n).toBe(1);
    expect((await getReceptionist(id, scopeClinic)).status).toBe(1);

    // out-of-scope status change touches nothing
    expect(await bulkSetReceptionistStatus([id], 0, scopeOther)).toBe(0);
    expect((await getReceptionist(id, scopeClinic)).status).toBe(1);
  });

  it('soft-delete sets user_status = 1', async () => {
    const { id } = await createReceptionist(
      { name: 'Reception Four', email: 'reception.four@test.local' },
      kcAdmin,
    );
    await deleteReceptionist(id, scopeClinic);
    expect((await getReceptionist(id, scopeClinic)).status).toBe(1);
  });
});
