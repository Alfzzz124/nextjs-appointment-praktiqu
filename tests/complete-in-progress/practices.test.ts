import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import {
  bulkDeletePractices,
  bulkSetPracticeStatus,
  exportPractices,
  listPracticeUsers,
} from '@/services/practice/service';

let practice1Id: string;

beforeAll(async () => {
  const practice = await prisma.clinic.findFirst();
  if (!practice) throw new Error('Need at least 1 practice/clinic in DB');
  practice1Id = practice.id;
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
