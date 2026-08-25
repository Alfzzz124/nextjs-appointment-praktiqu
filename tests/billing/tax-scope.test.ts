import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertTestDb, seedTax, cleanup } from './fixtures';
import {
  getTax, updateTax, deleteTax, setTaxStatus, bulkDeleteTaxes, bulkSetTaxStatus,
  type TaxScope,
} from '@/services/billing/tax.service';

/**
 * Cross-tenant row-scope regression suite (Critical finding, feat/encounter-documents
 * pre-merge review): `getTax`/`updateTax`/`deleteTax`/`setTaxStatus` never read
 * `KcTax.clinicId` at all, and the bulk delete/status endpoints were unscoped too even
 * though `tax_manage` includes CLINIC_ADMIN. This proves clinic A cannot reach clinic
 * B's tax rows, while a global tax (clinicId -1/null) stays visible everywhere, same
 * as the existing `listTaxes` semantics.
 */

const CLINIC_A = 9_030_001, CLINIC_B = 9_030_002;
const scopeA: TaxScope = { clinicId: BigInt(CLINIC_A) };
const scopeFailClosed: TaxScope = { clinicId: -1n }; // clinic staff with no resolved clinic

let taxAId: number, taxBId: number, taxGlobalId: number;

beforeAll(async () => {
  assertTestDb();
  await cleanup();
  taxAId = Number((await seedTax({ id: 9_030_101, name: 'Tax A', clinicId: CLINIC_A, taxValue: '5' })).id);
  taxBId = Number((await seedTax({ id: 9_030_102, name: 'Tax B', clinicId: CLINIC_B, taxValue: '7' })).id);
  taxGlobalId = Number((await seedTax({ id: 9_030_103, name: 'Tax Global', clinicId: -1, taxValue: '9' })).id);
});
afterAll(cleanup);

describe('getTax scope', () => {
  it('clinic A cannot read clinic B\'s tax (404, not 403)', async () => {
    await expect(getTax(taxBId, scopeA)).rejects.toMatchObject({ httpStatus: 404 });
    expect((await getTax(taxAId, scopeA)).id).toBe(taxAId);
  });

  it('a global tax stays visible to every clinic-scoped role', async () => {
    expect((await getTax(taxGlobalId, scopeA)).id).toBe(taxGlobalId);
  });

  it('a null clinicId (no clinic mapping) fails closed for a clinic-owned tax', async () => {
    await expect(getTax(taxAId, scopeFailClosed)).rejects.toMatchObject({ httpStatus: 404 });
    await expect(getTax(taxBId, scopeFailClosed)).rejects.toMatchObject({ httpStatus: 404 });
    // ...but the global tax is still reachable, matching listTaxes' own semantics.
    expect((await getTax(taxGlobalId, scopeFailClosed)).id).toBe(taxGlobalId);
  });

  it('SUPER_ADMIN (null scope) sees everything', async () => {
    expect((await getTax(taxAId, null)).id).toBe(taxAId);
    expect((await getTax(taxBId, null)).id).toBe(taxBId);
  });
});

describe('updateTax / deleteTax / setTaxStatus scope', () => {
  it('clinic A cannot update clinic B\'s tax', async () => {
    await expect(updateTax(taxBId, { rateValue: 99 }, scopeA)).rejects.toMatchObject({ httpStatus: 404 });
    const unchanged = await getTax(taxBId, null);
    expect(unchanged.taxValue).toBe(7);
  });

  it('clinic A can update its own tax', async () => {
    await updateTax(taxAId, { rateValue: 11 }, scopeA);
    expect((await getTax(taxAId, null)).taxValue).toBe(11);
  });

  it('clinic A cannot set status on clinic B\'s tax', async () => {
    await expect(setTaxStatus(taxBId, 0, scopeA)).rejects.toMatchObject({ httpStatus: 404 });
    expect((await getTax(taxBId, null)).status).toBe(1);
  });

  it('clinic A cannot delete clinic B\'s tax', async () => {
    await expect(deleteTax(taxBId, scopeA)).rejects.toMatchObject({ httpStatus: 404 });
    expect((await getTax(taxBId, null)).id).toBe(taxBId); // still there
  });
});

describe('bulk tax mutations scope', () => {
  it('bulkSetTaxStatus only changes rows in scope, silently skipping the rest', async () => {
    const n = await bulkSetTaxStatus([taxAId, taxBId], 0, scopeA);
    expect(n).toBe(1);
    expect((await getTax(taxAId, null)).status).toBe(0);
    expect((await getTax(taxBId, null)).status).toBe(1); // untouched
  });

  it('bulkDeleteTaxes only deletes rows in scope', async () => {
    const extraA = await seedTax({ id: 9_030_104, name: 'Tax A2', clinicId: CLINIC_A, taxValue: '1' });
    const n = await bulkDeleteTaxes([Number(extraA.id), taxBId], scopeA);
    expect(n).toBe(1);
    await expect(getTax(Number(extraA.id), null)).rejects.toThrow(); // deleted
    expect((await getTax(taxBId, null)).id).toBe(taxBId); // survived
  });
});
