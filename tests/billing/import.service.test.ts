import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb, seedClinicAdmin, cleanup } from './fixtures';
import { runImport } from '@/services/billing/import/engine';

// DB-BACKED: only run against a real test DB (assertTestDb guards fixtures).
// Not run in the live-DB dev environment.
const CLINIC = 9_000_001, ADMIN = 9_000_002;

// A CLINIC_ADMIN actor scoped to CLINIC — clinic_id is forced to kc.clinicId on every row.
const kcAdmin = {
  actor: { id: 'test-admin-9000002', role: 'CLINIC_ADMIN', practiceId: null },
  wpUserId: BigInt(ADMIN),
  clinicId: BigInt(CLINIC),
} as any;

describe('import.service (DB-backed)', () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedClinicAdmin({ userId: ADMIN, clinicId: CLINIC });
  });
  afterAll(cleanup);

  it('imports 2 tax rows (imported=2)', async () => {
    const rows = [
      { name: 'Import VAT', tax_type: 'percentage', tax_value: '10', status: '1' },
      { name: 'Import GST', tax_type: 'fixed', tax_value: '5', status: '1' },
    ];
    const res = await runImport('taxes', rows, { conflictStrategy: 'error', dryRun: false }, kcAdmin);
    expect(res.imported).toBe(2);
    expect(res.failed).toBe(0);

    const taxes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT name FROM wp_kc_taxes WHERE clinic_id = ? ORDER BY name`, CLINIC,
    );
    expect(taxes.map((t) => t.name)).toEqual(['Import GST', 'Import VAT']);
  });

  it('re-import of a duplicate behaves per conflictStrategy', async () => {
    const dup = [{ name: 'Import VAT', tax_type: 'percentage', tax_value: '10', status: '1' }];

    // error → failed (conflict)
    const errRes = await runImport('taxes', dup, { conflictStrategy: 'error', dryRun: false }, kcAdmin);
    expect(errRes.failed).toBe(1);
    expect(errRes.imported).toBe(0);
    expect(errRes.errors[0].message).toMatch(/already exists/i);

    // skip → skipped
    const skipRes = await runImport('taxes', dup, { conflictStrategy: 'skip', dryRun: false }, kcAdmin);
    expect(skipRes.skipped).toBe(1);
    expect(skipRes.imported).toBe(0);

    // update → updated (tax_value changed)
    const updRows = [{ name: 'Import VAT', tax_type: 'percentage', tax_value: '20', status: '1' }];
    const updRes = await runImport('taxes', updRows, { conflictStrategy: 'update', dryRun: false }, kcAdmin);
    expect(updRes.updated).toBe(1);
    const after = await prisma.$queryRawUnsafe<any[]>(
      `SELECT tax_value FROM wp_kc_taxes WHERE name = ? AND clinic_id = ? LIMIT 1`, 'Import VAT', CLINIC,
    );
    expect(String(after[0].tax_value)).toBe('20');
  });

  it('imports 1 doctor: creates wp_users + capability meta + clinic mapping', async () => {
    const rows = [{ name: 'Dr Import', email: 'dr.import@clinic.import.test' }];
    const res = await runImport('doctors', rows, { conflictStrategy: 'error', dryRun: false }, kcAdmin);
    expect(res.imported).toBe(1);
    expect(res.failed).toBe(0);

    const users = await prisma.$queryRawUnsafe<any[]>(
      `SELECT ID, display_name FROM wp_users WHERE user_email = ? LIMIT 1`, 'dr.import@clinic.import.test',
    );
    expect(users[0]).toBeTruthy();
    const wpId = Number(users[0].ID);
    expect(users[0].display_name).toBe('Dr Import');

    // Capability meta must be EXACTLY this (kiviCare_doctor = 15 chars).
    const cap = await prisma.$queryRawUnsafe<any[]>(
      `SELECT meta_value FROM wp_usermeta WHERE user_id = ? AND meta_key = 'wp_capabilities'`, wpId,
    );
    expect(cap[0]?.meta_value).toBe('a:1:{s:15:"kiviCare_doctor";b:1;}');

    // Doctor→clinic mapping created for the forced clinic.
    const mapping = await prisma.$queryRawUnsafe<any[]>(
      `SELECT clinic_id FROM wp_kc_doctor_clinic_mappings WHERE doctor_id = ? LIMIT 1`, wpId,
    );
    expect(Number(mapping[0].clinic_id)).toBe(CLINIC);
  });

  it('re-import of the same doctor email conflicts (error → failed)', async () => {
    const rows = [{ name: 'Dr Import', email: 'dr.import@clinic.import.test' }];
    const res = await runImport('doctors', rows, { conflictStrategy: 'error', dryRun: false }, kcAdmin);
    expect(res.failed).toBe(1);
    expect(res.imported).toBe(0);
  });
});
