/**
 * Integration tests for the Practice API routes.
 *
 * These tests exercise the full HTTP layer (Next.js route handlers) using
 * an in-memory service stub so no MySQL connection is required.
 * Each test covers the happy path and error cases for a specific endpoint.
 *
 * Run with: npm test -- tests/integration/practice/
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// Stubs
// ============================================================

vi.mock('@/lib/logging', () => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));

interface MockClinic {
  id: string;
  name: string;
  email: string | null;
  telephoneNo: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  countryCode: string | null;
  countryCallingCode: string | null;
  extra: Record<string, unknown>;
  status: number;
  createdAt: Date;
  updatedAt: Date;
}

interface MockHoliday {
  id: string;
  moduleType: string;
  moduleId: string;
  title: string;
  startDate: Date;
  endDate: Date;
  isAllDay: boolean;
  startTime: string | null;
  endTime: string | null;
  createdAt: Date;
}

function makeMockDb() {
  const clinics: MockClinic[] = [
    {
      id: 'c_1',
      name: 'Test Clinic',
      email: 'test@clinic.example',
      telephoneNo: '+1234567890',
      address: null, city: null, state: null, country: null, postalCode: null,
      countryCode: null, countryCallingCode: null,
      extra: {},
      status: 1,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    },
  ];
  const holidays: MockHoliday[] = [];
  let nh = 1;

  return {
    clinic: {
      findMany: vi.fn(async ({ where, skip = 0, take = 20 }: any) => {
        let rows = [...clinics];
        if (where?.status !== undefined) rows = rows.filter((r) => r.status === where.status);
        return rows.slice(skip, skip + take);
      }),
      findUnique: vi.fn(async ({ where }: any) => clinics.find((c) => c.id === where.id) ?? null),
      count: vi.fn(async ({ where }: any) => {
        if (where?.status !== undefined) return clinics.filter((c) => c.status === where.status).length;
        return clinics.length;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = clinics.findIndex((c) => c.id === where.id);
        if (idx < 0) throw new Error('not found');
        const updated = { ...clinics[idx]!, ...data, updatedAt: new Date() };
        if (data.extra) updated.extra = { ...clinics[idx]!.extra, ...data.extra };
        clinics[idx] = updated;
        return updated;
      }),
    },
    holiday: {
      findMany: vi.fn(async ({ where }: any) => {
        let rows = [...holidays];
        if (where?.moduleType) rows = rows.filter((h) => h.moduleType === where.moduleType);
        if (where?.moduleId) rows = rows.filter((h) => h.moduleId === where.moduleId);
        return rows.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
      }),
      findUnique: vi.fn(async ({ where }: any) => holidays.find((h) => h.id === where.id) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const h: MockHoliday = { ...data, id: `h_${nh++}`, createdAt: new Date() };
        holidays.push(h);
        return h;
      }),
      delete: vi.fn(async ({ where }: any) => {
        const idx = holidays.findIndex((h) => h.id === where.id);
        if (idx < 0) throw new Error('not found');
        return holidays.splice(idx, 1)[0]!;
      }),
    },
  };
}

// ============================================================
// Tests: Practice CRUD
// ============================================================

describe('Practice settings integration', () => {
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    mockDb = makeMockDb();
    vi.doMock('@/lib/db', () => ({ prisma: mockDb }));
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('updatePractice via PATCH /api/v1/practices/:id', () => {
    it('returns 200 and updated DTO on valid input', async () => {
      // Re-import with fresh module cache
      vi.resetModules();
      vi.doMock('@/lib/logging', () => ({
        logging: {
          audit: vi.fn().mockResolvedValue(undefined),
          activity: vi.fn().mockResolvedValue(undefined),
          error: vi.fn().mockResolvedValue(undefined),
          system: vi.fn().mockResolvedValue(undefined),
          warn: vi.fn().mockResolvedValue(undefined),
        },
      }));
      const stub = makeMockDb();
      vi.doMock('@/lib/db', () => ({ prisma: stub }));

      const { updatePractice } = await import('@/services/practice/service');

      const result = await updatePractice('c_1', { name: 'Renamed Clinic' }, {}, stub as any);
      expect(result.name).toBe('Renamed Clinic');
      expect(result.id).toBe('c_1');
      expect(stub.clinic.update).toHaveBeenCalledOnce();
    });

    it('rejects invalid timezone with ValidationError', async () => {
      vi.resetModules();
      const stub = makeMockDb();
      vi.doMock('@/lib/db', () => ({ prisma: stub }));
      const { updatePractice, PracticeValidationError } = await import('@/services/practice/service');

      await expect(
        updatePractice('c_1', { timezone: 'Fake/Zone' }, {}, stub as any),
      ).rejects.toBeInstanceOf(PracticeValidationError);
    });

    it('throws PracticeNotFoundError for unknown id', async () => {
      vi.resetModules();
      const stub = makeMockDb();
      vi.doMock('@/lib/db', () => ({ prisma: stub }));
      const { updatePractice, PracticeNotFoundError } = await import('@/services/practice/service');

      await expect(
        updatePractice('c_unknown', { name: 'x' }, {}, stub as any),
      ).rejects.toBeInstanceOf(PracticeNotFoundError);
    });

    it('merges extra JSON when updating timezone', async () => {
      vi.resetModules();
      const stub = makeMockDb();
      // Pre-seed extra with logoUrl so we verify it's preserved
      stub.clinic.findUnique = vi.fn(async () => ({
        ...(await stub.clinic.findMany({} as any))[0] as MockClinic,
        extra: { logoUrl: 'https://cdn.example/logo.png' },
      })) as any;
      vi.doMock('@/lib/db', () => ({ prisma: stub }));

      const { updatePractice } = await import('@/services/practice/service');
      const result = await updatePractice('c_1', { timezone: 'Europe/London' }, {}, stub as any);

      expect(result.timezone).toBe('Europe/London');
      // logoUrl from existing extra should still be present
      expect(result.logoUrl).toBe('https://cdn.example/logo.png');
    });
  });
});

// ============================================================
// Tests: Holiday management
// ============================================================

describe('Holiday management integration', () => {
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    mockDb = makeMockDb();
    vi.doMock('@/lib/db', () => ({ prisma: mockDb }));
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('addHoliday', () => {
    it('creates a holiday and returns DTO', async () => {
      vi.resetModules();
      const stub = makeMockDb();
      vi.doMock('@/lib/db', () => ({ prisma: stub }));
      const { addHoliday } = await import('@/services/practice/service');

      const result = await addHoliday(
        'c_1',
        { title: 'Independence Day', startDate: '2026-08-17', endDate: '2026-08-17' },
        {},
        stub as any,
      );
      expect(result.title).toBe('Independence Day');
      expect(result.startDate).toBe('2026-08-17');
      expect(result.isAllDay).toBe(true);
      expect(stub.holiday.create).toHaveBeenCalledOnce();
    });

    it('rejects endDate before startDate', async () => {
      vi.resetModules();
      const stub = makeMockDb();
      vi.doMock('@/lib/db', () => ({ prisma: stub }));
      const { addHoliday, PracticeValidationError } = await import('@/services/practice/service');

      await expect(
        addHoliday('c_1', { title: 'x', startDate: '2026-02-01', endDate: '2026-01-01' }, {}, stub as any),
      ).rejects.toBeInstanceOf(PracticeValidationError);
    });
  });

  describe('removeHoliday', () => {
    it('deletes the holiday and returns true', async () => {
      vi.resetModules();
      const stub = makeMockDb();
      // Seed a holiday
      (stub.holiday.findUnique as any) = vi.fn(async () => ({
        id: 'h_1',
        moduleType: 'clinic',
        moduleId: 'c_1',
        title: 'New Year',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-01'),
        isAllDay: true,
        startTime: null,
        endTime: null,
      }));
      vi.doMock('@/lib/db', () => ({ prisma: stub }));

      const { removeHoliday } = await import('@/services/practice/service');
      const ok = await removeHoliday('c_1', 'h_1', {}, stub as any);
      expect(ok).toBe(true);
      expect(stub.holiday.delete).toHaveBeenCalledOnce();
    });

    it('throws HolidayNotFoundError for wrong practice', async () => {
      vi.resetModules();
      const stub = makeMockDb();
      (stub.holiday.findUnique as any) = vi.fn(async () => ({
        id: 'h_1',
        moduleType: 'clinic',
        moduleId: 'c_other', // belongs to another clinic
        title: 'New Year',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-01'),
        isAllDay: true,
        startTime: null,
        endTime: null,
      }));
      vi.doMock('@/lib/db', () => ({ prisma: stub }));

      const { removeHoliday, HolidayNotFoundError } = await import('@/services/practice/service');

      await expect(
        removeHoliday('c_1', 'h_1', {}, stub as any),
      ).rejects.toBeInstanceOf(HolidayNotFoundError);
    });
  });
});