import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import {
  bulkDeletePractices,
  bulkSetPracticeStatus,
  exportPractices,
  listPracticeUsers,
} from '@/services/practice/service';

/** wp_kc_clinics.id — numeric since practices moved to KiviCare (D2). */
let practice1Id: number;

/** Test-owned clinic id, below billing's TEST_MARKER range. */
const SEED_CLINIC = 7_800_001;

beforeAll(async () => {
  // Seeds its own clinic rather than reading the shadow `clinics` table, which is
  // empty now that practices come from wp_kc_clinics.
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id = ?`, SEED_CLINIC);
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, 'Practices Suite Clinic', 1, 1, 0, NOW())`,
    SEED_CLINIC,
  );
  practice1Id = SEED_CLINIC;
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id = ?`, SEED_CLINIC);
});

describe('bulkDeletePractices', () => {
  it('returns 0 for empty ids', async () => {
    const n = await bulkDeletePractices([]);
    expect(n).toBe(0);
  });
});

describe('bulkSetPracticeStatus', () => {
  it('returns 0 for empty ids', async () => {
    const n = await bulkSetPracticeStatus([], 0);
    expect(n).toBe(0);
  });
});

describe('exportPractices', () => {
  it('returns an array with at least one practice', async () => {
    const rows = await exportPractices({});
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('listPracticeUsers', () => {
  it('returns an array for a valid practice', async () => {
    const users = await listPracticeUsers(practice1Id);
    expect(Array.isArray(users)).toBe(true);
  });
});
