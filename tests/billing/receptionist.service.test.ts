import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb, seedClinicAdmin, cleanup } from './fixtures';
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
