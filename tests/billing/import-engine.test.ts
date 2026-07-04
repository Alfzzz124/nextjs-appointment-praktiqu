import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub adapters injected in place of the real (DB-backed) registry. The engine
// only touches adapters[entity].{findExisting,insert,update}, so mocking this
// module keeps the whole test DB-free.
const insert = vi.fn(async (_row: any, _kc: any): Promise<void> => {});
const update = vi.fn(async (_id: number, _row: any, _kc: any): Promise<void> => {});
const findExisting = vi.fn(async (_row: any, _kc: any): Promise<number | null> => null);

vi.mock('@/services/billing/import/adapters', () => ({
  adapters: {
    taxes: { findExisting: (r: any, k: any) => findExisting(r, k), insert: (r: any, k: any) => insert(r, k), update: (id: number, r: any, k: any) => update(id, r, k) },
  },
}));

import { runImport, parseCsv } from '@/services/billing/import/engine';
import { importTemplates } from '@/services/billing/import/templates';
import { IMPORT_ENTITIES } from '@/services/billing/import/validation';

const kc = { actor: { id: 'x', role: 'SUPER_ADMIN', practiceId: null }, wpUserId: 1n, clinicId: null } as any;
const opts = (conflictStrategy: 'error' | 'skip' | 'update', dryRun = false) => ({ conflictStrategy, dryRun });

// Two schema-valid tax rows.
const validRows = () => ([
  { name: 'VAT', tax_type: 'percentage', tax_value: '10', status: '1' },
  { name: 'GST', tax_type: 'fixed', tax_value: '5', status: '1' },
]);

beforeEach(() => {
  insert.mockReset().mockResolvedValue(undefined);
  update.mockReset().mockResolvedValue(undefined);
  findExisting.mockReset().mockResolvedValue(null);
});

describe('runImport — counts', () => {
  it('imports all rows when there is no conflict', async () => {
    const res = await runImport('taxes', validRows(), opts('error'), kc);
    expect(res.total).toBe(2);
    expect(res.imported).toBe(2);
    expect(res.updated).toBe(0);
    expect(res.skipped).toBe(0);
    expect(res.failed).toBe(0);
    expect(res.errors).toHaveLength(0);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(res.jobId).toMatch(/[0-9a-f-]{36}/);
  });

  it('counts a schema-invalid row as failed with a message (does not insert it)', async () => {
    const rows = [
      { name: 'VAT', tax_type: 'percentage', tax_value: '10' },
      { name: '', tax_type: 'percentage', tax_value: 'not-a-number' }, // invalid: empty name + bad number
    ];
    const res = await runImport('taxes', rows, opts('error'), kc);
    expect(res.imported).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].row).toBe(2);
    expect(res.errors[0].message).toBeTruthy();
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

describe('runImport — conflict strategies', () => {
  it('error → conflicting row is failed', async () => {
    findExisting.mockResolvedValueOnce(42); // first row conflicts
    const res = await runImport('taxes', validRows(), opts('error'), kc);
    expect(res.failed).toBe(1);
    expect(res.imported).toBe(1);
    expect(res.errors[0]).toMatchObject({ row: 1 });
    expect(res.errors[0].message).toMatch(/already exists/i);
    expect(insert).toHaveBeenCalledTimes(1); // only the non-conflicting row
    expect(update).not.toHaveBeenCalled();
  });

  it('skip → conflicting row is skipped', async () => {
    findExisting.mockResolvedValueOnce(42);
    const res = await runImport('taxes', validRows(), opts('skip'), kc);
    expect(res.skipped).toBe(1);
    expect(res.imported).toBe(1);
    expect(res.failed).toBe(0);
    expect(update).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('update → conflicting row is updated', async () => {
    findExisting.mockResolvedValueOnce(42);
    const res = await runImport('taxes', validRows(), opts('update'), kc);
    expect(res.updated).toBe(1);
    expect(res.imported).toBe(1);
    expect(res.failed).toBe(0);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(42, expect.anything(), kc);
  });
});

describe('runImport — dryRun', () => {
  it('performs no inserts or updates', async () => {
    findExisting.mockResolvedValueOnce(42); // row 1 conflicts → would update
    const res = await runImport('taxes', validRows(), opts('update', true), kc);
    expect(res.dryRun).toBe(true);
    expect(res.updated).toBe(1);
    expect(res.imported).toBe(1);
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('parseCsv', () => {
  it('parses a header CSV into row objects', () => {
    const csv = 'name,tax_type,tax_value\nVAT,percentage,10\nGST,fixed,5\n';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: 'VAT', tax_type: 'percentage', tax_value: '10' });
    expect(rows[1]).toEqual({ name: 'GST', tax_type: 'fixed', tax_value: '5' });
  });
});

describe('importTemplates', () => {
  it('returns all 9 entities with columns + a sample row', () => {
    const { templates } = importTemplates();
    expect(templates).toHaveLength(9);
    expect(templates.map((t) => t.entity).sort()).toEqual([...IMPORT_ENTITIES].sort());
    for (const t of templates) {
      expect(Array.isArray(t.columns)).toBe(true);
      expect(t.columns.length).toBeGreaterThan(0);
      expect(typeof t.sample).toBe('object');
    }
  });

  it('filters to a single entity when given one', () => {
    const { templates } = importTemplates('taxes');
    expect(templates).toHaveLength(1);
    expect(templates[0].entity).toBe('taxes');
  });
});
