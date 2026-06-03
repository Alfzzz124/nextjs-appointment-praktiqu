// tests/integration/booking/professional-list.test.ts
import { describe, it, expect, vi } from 'vitest';
import { GET } from '@/app/api/v1/public/professionals/route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professional: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'p1', fullName: 'Dr. A', professionalType: 'PSIKOLOG_KLINIS', biography: 'Test', specialties: ['Anxiety'], user: { id: 'u1', displayName: 'Dr. A', firstName: 'A' } },
      ]),
    },
    professionalAvailability: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

function makeReq(url: string) { return new Request(url) as any; }

describe('GET /api/v1/public/professionals', () => {
  it('returns list', async () => {
    const res = await GET(makeReq('http://localhost/api/v1/public/professionals'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toBeDefined();
  });
});