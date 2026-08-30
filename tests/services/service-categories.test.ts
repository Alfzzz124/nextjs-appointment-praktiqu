/**
 * Service categories — `wp_kc_static_data` rows of type `service_type`.
 *
 * These are what KiviCare's `category` parameter points at, and their `value` is what
 * lands in `wp_kc_services.type`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  kcStaticData: { findMany: vi.fn(), findFirst: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

import {
  STATIC_DATA_TYPE,
  listServiceTypes,
  findServiceTypeById,
} from '@/repositories/wp/static-data.repo';

const row = {
  id: 7n,
  type: 'service_type',
  label: 'Psychology Services',
  value: 'psychology_services',
  parentId: null,
  status: 1n,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

beforeEach(() => {
  db.kcStaticData.findMany.mockReset();
  db.kcStaticData.findFirst.mockReset();
});

describe('listServiceTypes', () => {
  it('queries only active service_type rows', async () => {
    db.kcStaticData.findMany.mockResolvedValue([row]);

    const result = await listServiceTypes();

    expect(db.kcStaticData.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { type: 'service_type', status: 1n } }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('psychology_services');
    expect(result[0].isActive).toBe(true);
  });

  it('drops the status filter when includeInactive is set', async () => {
    db.kcStaticData.findMany.mockResolvedValue([]);

    await listServiceTypes({ includeInactive: true });

    expect(db.kcStaticData.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { type: 'service_type' } }),
    );
  });
});

describe('findServiceTypeById', () => {
  it('returns the row when it is an active service_type', async () => {
    db.kcStaticData.findFirst.mockResolvedValue(row);

    const found = await findServiceTypeById(7n);

    expect(db.kcStaticData.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7n, type: 'service_type', status: 1n } }),
    );
    expect(found?.value).toBe('psychology_services');
  });

  it('returns null when the id belongs to another type or is inactive', async () => {
    db.kcStaticData.findFirst.mockResolvedValue(null);

    expect(await findServiceTypeById(999n)).toBeNull();
  });
});

describe('STATIC_DATA_TYPE', () => {
  it('carries the service_type key KiviCare writes', () => {
    expect(STATIC_DATA_TYPE.SERVICE_TYPE).toBe('service_type');
  });
});
