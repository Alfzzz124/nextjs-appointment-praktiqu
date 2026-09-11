/**
 * POST /api/v1/public/appointments — the Idempotency-Key path.
 *
 * The service itself is covered against a real database in
 * booking-idempotency.test.ts. What is under test here is only the wiring: that
 * the route claims before booking, completes on success, releases on failure,
 * and answers each claim verdict with the right status.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/services/public/public-booking.service', () => ({
  createPublicAppointment: vi.fn(),
  getPublicAppointmentById: vi.fn(),
  createPublicAppointmentSchema: {
    safeParse: (b: unknown) => ({ success: true, data: b }),
  },
  AppointmentInsertError: class AppointmentInsertError extends Error {},
  EmailConflictError: class EmailConflictError extends Error {},
  HoldExpiredError: class HoldExpiredError extends Error {},
  ProfessionalNotFoundError: class ProfessionalNotFoundError extends Error {},
  ServiceNotFoundError: class ServiceNotFoundError extends Error {},
  SlotConflictError: class SlotConflictError extends Error {},
  BookingTooSoonError: class BookingTooSoonError extends Error {},
  UpstreamWriteError: class UpstreamWriteError extends Error {
    upstreamStatus = 400;
    operation = 'test';
  },
}));

vi.mock('@/services/public/booking-idempotency.service', () => ({
  claimIdempotencyKey: vi.fn(),
  completeIdempotencyKey: vi.fn(),
  releaseIdempotencyKey: vi.fn(),
  fingerprintOf: vi.fn(() => 'fp'),
}));

import { POST } from '@/app/api/v1/public/appointments/route';
import * as booking from '@/services/public/public-booking.service';
import * as idem from '@/services/public/booking-idempotency.service';

const APPT = { id: 99, status: 1, date: '2026-09-20', startTime: '09:00', service: 's', professionalName: 'p', clientName: 'c', token: 't' };

let n = 0;
function req(key?: string) {
  n += 1;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key) headers['Idempotency-Key'] = key;
  return new NextRequest('http://x/api/v1/public/appointments', {
    method: 'POST',
    headers,
    // A distinct email per request keeps the module-level rate limiter out of the way.
    body: JSON.stringify({ clientEmail: `t${n}@example.com`, holdKey: 'h', startTime: '09:00' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (booking.createPublicAppointment as any).mockResolvedValue(APPT);
  (idem.claimIdempotencyKey as any).mockResolvedValue({ kind: 'claimed' });
});

describe('without an Idempotency-Key', () => {
  it('books as before and touches no key', async () => {
    const res = await POST(req());
    expect(res.status).toBe(201);
    expect(booking.createPublicAppointment).toHaveBeenCalledOnce();
    expect(idem.claimIdempotencyKey).not.toHaveBeenCalled();
  });
});

describe('with an Idempotency-Key', () => {
  it('claims before booking, and records the appointment after', async () => {
    const res = await POST(req('k1'));
    expect(res.status).toBe(201);
    expect(idem.claimIdempotencyKey).toHaveBeenCalledOnce();
    expect(booking.createPublicAppointment).toHaveBeenCalledOnce();
    expect(idem.completeIdempotencyKey).toHaveBeenCalledWith('k1', 99);
  });

  it('replays without booking again', async () => {
    (idem.claimIdempotencyKey as any).mockResolvedValue({ kind: 'replay', appointmentId: 99 });
    (booking.getPublicAppointmentById as any).mockResolvedValue({ ...APPT });
    const res = await POST(req('k1'));
    expect(res.status).toBe(200);
    expect(booking.createPublicAppointment).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ data: { id: 99 } });
  });

  it('answers 409 with Retry-After while another attempt holds the key', async () => {
    (idem.claimIdempotencyKey as any).mockResolvedValue({ kind: 'in_progress' });
    const res = await POST(req('k1'));
    expect(res.status).toBe(409);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(booking.createPublicAppointment).not.toHaveBeenCalled();
  });

  it('refuses a key reused for a different booking', async () => {
    (idem.claimIdempotencyKey as any).mockResolvedValue({ kind: 'fingerprint_mismatch' });
    const res = await POST(req('k1'));
    expect(res.status).toBe(422);
    expect(booking.createPublicAppointment).not.toHaveBeenCalled();
  });

  it('releases the key when the booking fails, so an honest retry can claim it', async () => {
    (booking.createPublicAppointment as any).mockRejectedValue(new Error('boom'));
    // The route logs unexpected errors, which is right — silenced here so the run
    // stays readable, and asserted so silencing it cannot hide the log going away.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await POST(req('k1'));
      expect(idem.releaseIdempotencyKey).toHaveBeenCalledWith('k1');
      expect(idem.completeIdempotencyKey).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it('404s when the appointment a key points at no longer exists', async () => {
    (idem.claimIdempotencyKey as any).mockResolvedValue({ kind: 'replay', appointmentId: 99 });
    (booking.getPublicAppointmentById as any).mockResolvedValue(null);
    const res = await POST(req('k1'));
    expect(res.status).toBe(404);
    expect(booking.createPublicAppointment).not.toHaveBeenCalled();
  });

  it('maps a too-soon booking to 409 rather than a 500', async () => {
    const { BookingTooSoonError } = booking as unknown as { BookingTooSoonError: new () => Error };
    (booking.createPublicAppointment as any).mockRejectedValue(new BookingTooSoonError());
    const res = await POST(req('k1'));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ title: expect.anything() });
    // The key must come back: the slot is fine, the timing was not, so a later
    // attempt with the same key is legitimate.
    expect(idem.releaseIdempotencyKey).toHaveBeenCalledWith('k1');
  });
});
