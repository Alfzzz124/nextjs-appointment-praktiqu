import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertTestDb, seedClinicAdmin, cleanup } from './fixtures';
import { PracticeNotFoundError, assertPracticeInScope } from '@/services/practice/service';
import type { Actor } from '@/lib/auth';

/**
 * Cross-tenant row-scope regression suite (Critical finding, feat/encounter-documents
 * pre-merge review, extended during audit): every `/practices/:id` route — and its
 * `/settings`, `/holidays`, `/users` siblings — gated CLINIC_ADMIN by role alone, so
 * any clinic admin could read or write ANY other clinic by id. `assertPracticeInScope`
 * closes that; this proves it 404s (never 403s) a mismatched clinic and passes SUPER_ADMIN
 * through unrestricted.
 */

const CLINIC_A = 9_040_001, CLINIC_B = 9_040_002;

beforeAll(async () => {
  assertTestDb();
  await cleanup();
  await seedClinicAdmin({ userId: CLINIC_A, clinicId: CLINIC_A });
  await seedClinicAdmin({ userId: CLINIC_B, clinicId: CLINIC_B });
});
afterAll(cleanup);

const actorA: Actor = { id: `test-admin-${CLINIC_A}`, role: 'CLINIC_ADMIN', practiceId: null };
const actorSuper: Actor = { id: 'anyone', role: 'SUPER_ADMIN', practiceId: null };

describe('assertPracticeInScope', () => {
  it('SUPER_ADMIN is unrestricted (never even resolves a clinic mapping)', async () => {
    await expect(assertPracticeInScope(actorSuper, CLINIC_B)).resolves.toBeUndefined();
  });

  it('a CLINIC_ADMIN may act on their own practice', async () => {
    await expect(assertPracticeInScope(actorA, CLINIC_A)).resolves.toBeUndefined();
  });

  it('a CLINIC_ADMIN gets 404 (PracticeNotFoundError), never 403, for another clinic', async () => {
    await expect(assertPracticeInScope(actorA, CLINIC_B)).rejects.toBeInstanceOf(PracticeNotFoundError);
  });
});
