/**
 * Task 8: route integration tests for the public booking slice (Slice 2).
 *
 * Service modules are mocked so these tests are DB-free.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/services/public/public-catalog.service', () => ({
  listPublicPractices: vi.fn().mockResolvedValue([{ id: 'c1', name: 'Clinic One' }]),
  getPublicPractice: vi.fn(),
  getPublicProfessionalServices: vi.fn().mockResolvedValue([]),
  getPublicStaticData: vi.fn().mockResolvedValue({ gender: ['MALE'], professionalType: [], serviceType: [], dynamic: {} }),
  getPublicBookingConfig: vi.fn().mockReturnValue({ slotHoldTtlMs: 900000, minBookingNoticeMinutes: 60, maxAdvanceDays: 60 }),
  getRatingPrompt: vi.fn(),
}));

vi.mock('@/services/public/public-booking.service', () => ({
  getPublicAppointmentById: vi.fn(),
}));

import { GET as practicesList } from '@/app/api/v1/public/practices/route';
import { GET as practiceDetail } from '@/app/api/v1/public/practices/[id]/route';
import { GET as professionalServices } from '@/app/api/v1/public/professionals/[id]/services/route';
import { GET as staticData } from '@/app/api/v1/public/static-data/route';
import { GET as config } from '@/app/api/v1/public/config/route';
import { GET as rating } from '@/app/api/v1/public/rating/[id]/route';
import { GET as apptLookup } from '@/app/api/v1/public/appointments/[token]/route';
import { POST as bookingDeprecated } from '@/app/api/v1/public/booking/route';
import { signAppointmentToken } from '@/lib/public/appointment-token';
import * as catalog from '@/services/public/public-catalog.service';

function req(url: string) { return new NextRequest(url); }
beforeEach(() => vi.clearAllMocks());

describe('public catalog routes', () => {
  it('GET /public/practices → 200 with data array', async () => {
    const res = await practicesList();
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).data)).toBe(true);
  });
  it('GET /public/practices/[id] → 404 when clinic missing', async () => {
    (catalog.getPublicPractice as any).mockResolvedValue(null);
    const res = await practiceDetail(req('http://x/api/v1/public/practices/missing'), { params: { id: 'missing' } });
    expect(res.status).toBe(404);
  });
  it('GET /public/professionals/[id]/services → 200 with data array', async () => {
    (catalog.getPublicProfessionalServices as any).mockResolvedValue([{ id: 's1', name: 'Svc' }]);
    const res = await professionalServices(req('http://x/api/v1/public/professionals/29/services'), { params: { id: '29' } });
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).data)).toBe(true);
  });
  it('GET /public/professionals/[id]/services → 404 when professional missing', async () => {
    (catalog.getPublicProfessionalServices as any).mockResolvedValue(null);
    const res = await professionalServices(req('http://x/api/v1/public/professionals/missing/services'), { params: { id: 'missing' } });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('professional_not_found');
  });
  it('GET /public/static-data → 200', async () => {
    expect((await staticData()).status).toBe(200);
  });
  it('GET /public/config → 200 with slotHoldTtlMs', async () => {
    expect((await config().then(r => r.json())).data).toHaveProperty('slotHoldTtlMs');
  });
});

describe('deprecated booking', () => {
  it('POST /public/booking → 308', async () => {
    expect((await bookingDeprecated()).status).toBe(308);
  });
});

describe('rating prompt', () => {
  it('GET /public/rating/[id] → 400 on invalid token', async () => {
    (catalog.getRatingPrompt as any).mockResolvedValue(null);
    const res = await rating(req('http://x/api/v1/public/rating/bad'), { params: { id: 'bad' } });
    expect(res.status).toBe(400);
  });
});

describe('appointment token lookup', () => {
  it('GET /public/appointments/[token] → 400 on tampered token', async () => {
    const res = await apptLookup(req('http://x/api/v1/public/appointments/garbage'), { params: { token: 'garbage' } });
    expect(res.status).toBe(400);
  });
  it('signs a well-formed token', () => {
    expect(signAppointmentToken('appt-1').split('.')).toHaveLength(2);
  });
});
