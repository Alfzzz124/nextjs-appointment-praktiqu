/**
 * Unit tests for the Practice service.
 *
 * Strategy: inject an in-memory Prisma stub (the service exposes an optional
 * `injected` parameter) to keep these tests independent of MySQL/Prisma.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HolidayNotFoundError,
  PracticeNotFoundError,
  PracticeValidationError,
  addHoliday,
  getPractice,
  listHolidays,
  listPractices,
  removeHoliday,
  updatePractice,
} from '@/services/practice/service';
import type { PrismaClient } from '@prisma/client';

// ============================================================
// In-memory Prisma stub
// ============================================================

interface ClinicRow {
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

interface HolidayRow {
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

function newClinic(over: Partial<ClinicRow> = {}): ClinicRow {
  return {
    id: 'c_1',
    name: 'PraktiQU Demo Clinic',
    email: 'demo@praktiqu.test',
    telephoneNo: '+1234567890',
    address: '123 Demo St',
    city: 'Demo City',
    state: 'CA',
    country: 'US',
    postalCode: '90001',
    countryCode: 'US',
    countryCallingCode: '+1',
    extra: {},
    status: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

function newHoliday(over: Partial<HolidayRow> = {}): HolidayRow {
  return {
    id: 'h_1',
    moduleType: 'clinic',
    moduleId: 'c_1',
    title: 'New Year',
    startDate: new Date('2026-01-01T00:00:00Z'),
    endDate: new Date('2026-01-01T00:00:00Z'),
    isAllDay: true,
    startTime: null,
    endTime: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

function makeStub() {
  const clinics: ClinicRow[] = [];
  const holidays: HolidayRow[] = [];
  let nextClinic = 1;
  let nextHoliday = 1;

  return {
    clinic: {
      findMany: vi.fn(async ({ where, skip = 0, take = 20, orderBy }: any) => {
        let rows = clinics.slice();
        if (where?.status !== undefined) rows = rows.filter((r) => r.status === where.status);
        if (orderBy?.createdAt === 'desc') rows = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows.slice(skip, skip + take);
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        return clinics.find((c) => c.id === where.id) ?? null;
      }),
      count: vi.fn(async ({ where }: any = {}) => {
        if (where?.status !== undefined) return clinics.filter((c) => c.status === where.status).length;
        return clinics.length;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = clinics.findIndex((c) => c.id === where.id);
        if (idx < 0) throw new Error('not found');
        const updated: ClinicRow = { ...clinics[idx], ...data, updatedAt: new Date() };
        if (data.extra) updated.extra = { ...clinics[idx].extra, ...data.extra };
        clinics[idx] = updated;
        return updated;
      }),
      create: vi.fn(async ({ data }: any) => {
        const created = newClinic({ ...data, id: `c_${++nextClinic}` });
        clinics.push(created);
        return created;
      }),
    },
    holiday: {
      findMany: vi.fn(async ({ where, orderBy }: any) => {
        let rows = holidays.slice();
        if (where?.moduleType) rows = rows.filter((h) => h.moduleType === where.moduleType);
        if (where?.moduleId) rows = rows.filter((h) => h.moduleId === where.moduleId);
        if (orderBy?.startDate === 'asc') rows.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
        return rows;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        return holidays.find((h) => h.id === where.id) ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const created = newHoliday({ ...data, id: `h_${++nextHoliday}` });
        holidays.push(created);
        return created;
      }),
      delete: vi.fn(async ({ where }: any) => {
        const idx = holidays.findIndex((h) => h.id === where.id);
        if (idx < 0) throw new Error('not found');
        const [removed] = holidays.splice(idx, 1);
        return removed;
      }),
    },
    // introspection helpers for tests
    __clinics: clinics,
    __holidays: holidays,
  };
}

type Stub = ReturnType<typeof makeStub>;

// ============================================================
// logging stub — silences DB writes from the service
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

// ============================================================
// Tests
// ============================================================

let stub: Stub;
beforeEach(() => {
  stub = makeStub();
  stub.__clinics.push(newClinic());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('listPractices', () => {
  it('returns paginated practices', async () => {
    const { data, total, page, limit } = await listPractices({ page: 1, limit: 10 }, stub as unknown as PrismaClient);
    expect(total).toBe(1);
    expect(page).toBe(1);
    expect(limit).toBe(10);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe('PraktiQU Demo Clinic');
  });

  it('clamps limit to a sane range', async () => {
    const { limit } = await listPractices({ limit: 9999 }, stub as unknown as PrismaClient);
    expect(limit).toBe(100);
  });
});

describe('getPractice', () => {
  it('returns a practice by id', async () => {
    const dto = await getPractice('c_1', stub as unknown as PrismaClient);
    expect(dto.id).toBe('c_1');
    expect(dto.timezone).toBeNull();
    expect(dto.businessHours).toEqual([]);
  });

  it('throws PracticeNotFoundError when missing', async () => {
    await expect(getPractice('missing', stub as unknown as PrismaClient)).rejects.toBeInstanceOf(
      PracticeNotFoundError,
    );
  });

  it('reads timezone/logoUrl/businessHours from extra JSON', async () => {
    stub.__clinics[0].extra = {
      timezone: 'America/Los_Angeles',
      logoUrl: 'https://cdn.example/logo.png',
      businessHours: [{ dayOfWeek: 1, open: true, startTime: '09:00', endTime: '17:00' }],
    };
    const dto = await getPractice('c_1', stub as unknown as PrismaClient);
    expect(dto.timezone).toBe('America/Los_Angeles');
    expect(dto.logoUrl).toBe('https://cdn.example/logo.png');
    expect(dto.businessHours).toEqual([
      { dayOfWeek: 1, open: true, startTime: '09:00', endTime: '17:00' },
    ]);
  });
});

describe('updatePractice', () => {
  it('rejects unknown fields (strict mode)', async () => {
    await expect(
      updatePractice('c_1', { notAField: 1 }, {}, stub as unknown as PrismaClient),
    ).rejects.toBeInstanceOf(PracticeValidationError);
  });

  it('rejects invalid timezone', async () => {
    await expect(
      updatePractice('c_1', { timezone: 'Not/A_Zone' }, {}, stub as unknown as PrismaClient),
    ).rejects.toBeInstanceOf(PracticeValidationError);
  });

  it('rejects invalid countryCallingCode', async () => {
    await expect(
      updatePractice('c_1', { countryCallingCode: '123' }, {}, stub as unknown as PrismaClient),
    ).rejects.toBeInstanceOf(PracticeValidationError);
  });

  it('updates fields and merges extra JSON', async () => {
    const dto = await updatePractice(
      'c_1',
      {
        name: 'Renamed Clinic',
        timezone: 'Europe/London',
        businessHours: [{ dayOfWeek: 1, open: true, startTime: '08:00', endTime: '16:00' }],
      },
      { actorId: 'u_1' },
      stub as unknown as PrismaClient,
    );
    expect(dto.name).toBe('Renamed Clinic');
    expect(dto.timezone).toBe('Europe/London');
    expect(dto.businessHours).toEqual([
      { dayOfWeek: 1, open: true, startTime: '08:00', endTime: '16:00' },
    ]);
  });

  it('throws PracticeNotFoundError when missing', async () => {
    await expect(
      updatePractice('missing', { name: 'x' }, {}, stub as unknown as PrismaClient),
    ).rejects.toBeInstanceOf(PracticeNotFoundError);
  });
});

describe('listHolidays', () => {
  it('returns [] when the practice has no holidays', async () => {
    const out = await listHolidays('c_1', stub as unknown as PrismaClient);
    expect(out).toEqual([]);
  });

  it('returns holidays for the practice, ordered by startDate', async () => {
    stub.__holidays.push(
      newHoliday({ id: 'h_1', startDate: new Date('2026-02-01'), title: 'Feb' }),
      newHoliday({ id: 'h_2', startDate: new Date('2026-01-01'), title: 'Jan' }),
    );
    const out = await listHolidays('c_1', stub as unknown as PrismaClient);
    expect(out.map((h) => h.title)).toEqual(['Jan', 'Feb']);
  });

  it('throws PracticeNotFoundError if the practice does not exist', async () => {
    await expect(listHolidays('missing', stub as unknown as PrismaClient)).rejects.toBeInstanceOf(
      PracticeNotFoundError,
    );
  });
});

describe('addHoliday', () => {
  it('validates end >= start', async () => {
    await expect(
      addHoliday(
        'c_1',
        { title: 'Bad', startDate: '2026-02-01', endDate: '2026-01-01' },
        {},
        stub as unknown as PrismaClient,
      ),
    ).rejects.toBeInstanceOf(PracticeValidationError);
  });

  it('rejects malformed date strings', async () => {
    await expect(
      addHoliday('c_1', { title: 'x', startDate: '01-01-2026', endDate: '2026-01-01' }, {}, stub as unknown as PrismaClient),
    ).rejects.toBeInstanceOf(PracticeValidationError);
  });

  it('rejects invalid HH:mm times', async () => {
    await expect(
      addHoliday(
        'c_1',
        { title: 'x', startDate: '2026-01-01', endDate: '2026-01-01', startTime: '25:00' },
        {},
        stub as unknown as PrismaClient,
      ),
    ).rejects.toBeInstanceOf(PracticeValidationError);
  });

  it('creates a holiday and returns a DTO', async () => {
    const dto = await addHoliday(
      'c_1',
      { title: 'Xmas', startDate: '2026-12-25', endDate: '2026-12-25' },
      { actorId: 'u_1' },
      stub as unknown as PrismaClient,
    );
    expect(dto.practiceId).toBe('c_1');
    expect(dto.title).toBe('Xmas');
    expect(dto.startDate).toBe('2026-12-25');
    expect(dto.isAllDay).toBe(true);
  });

  it('throws PracticeNotFoundError if the practice does not exist', async () => {
    await expect(
      addHoliday('missing', { title: 'x', startDate: '2026-01-01', endDate: '2026-01-01' }, {}, stub as unknown as PrismaClient),
    ).rejects.toBeInstanceOf(PracticeNotFoundError);
  });
});

describe('removeHoliday', () => {
  it('removes an existing holiday scoped to the practice', async () => {
    stub.__holidays.push(newHoliday({ id: 'h_99' }));
    const ok = await removeHoliday('c_1', 'h_99', { actorId: 'u_1' }, stub as unknown as PrismaClient);
    expect(ok).toBe(true);
    expect(stub.__holidays).toHaveLength(0);
  });

  it('throws HolidayNotFoundError for missing id', async () => {
    await expect(
      removeHoliday('c_1', 'missing', {}, stub as unknown as PrismaClient),
    ).rejects.toBeInstanceOf(HolidayNotFoundError);
  });

  it('throws HolidayNotFoundError when the holiday belongs to another practice', async () => {
    stub.__holidays.push(newHoliday({ id: 'h_99', moduleId: 'c_other' }));
    await expect(
      removeHoliday('c_1', 'h_99', {}, stub as unknown as PrismaClient),
    ).rejects.toBeInstanceOf(HolidayNotFoundError);
  });
});
