/**
 * POST /api/v1/public/appointments — what happens AFTER the booking is written, and how
 * a retried request finds out whether it was.
 *
 * The 2026-11-17 audit (booking-submit-bayar-3 / -5): a failure after the appointment
 * exists must not turn into "nothing was saved, try again", because the try-again then
 * collides with the guest's own booking; and a key left in flight by a dead process must
 * be able to ask whether the booking landed.
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
  bookingFingerprintOf: vi.fn(() => 'fp'),
}));

vi.mock('@/services/public/booking-written-lookup', () => ({
  findWrittenPublicAppointment: vi.fn(),
}));

vi.mock('@/services/public/unpaid-booking', () => ({
  isStaffRequest: vi.fn(async () => false),
  scheduleUnpaidBookingCancel: vi.fn(async () => {}),
}));

import { POST } from '@/app/api/v1/public/appointments/route';
import * as booking from '@/services/public/public-booking.service';
import * as idem from '@/services/public/booking-idempotency.service';
import * as lookup from '@/services/public/booking-written-lookup';
import * as unpaid from '@/services/public/unpaid-booking';

const APPT = { id: 99, status: 'PENDING', date: '2026-09-20', startTime: '09:00', service: 's', professionalName: 'p', clientName: 'c', token: 't' };

let n = 0;
function req(key = 'k1') {
  n += 1;
  return new NextRequest('http://x/api/v1/public/appointments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
    // A distinct email per request keeps the module-level rate limiter out of the way.
    body: JSON.stringify({
      professionalId: 7,
      date: '2026-09-20',
      startTime: '09:00',
      clientEmail: `r${n}@example.com`,
      holdKey: 'h',
    }),
  });
}

/** Scheduling runs after the response; give it a tick. */
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  vi.clearAllMocks();
  (booking.createPublicAppointment as any).mockResolvedValue(APPT);
  (idem.claimIdempotencyKey as any).mockResolvedValue({ kind: 'claimed' });
  (unpaid.isStaffRequest as any).mockResolvedValue(false);
});

describe('a failure after the appointment was written', () => {
  it('still answers 201 with the booking, keeps the key, and schedules the auto-cancel', async () => {
    (idem.completeIdempotencyKey as any).mockRejectedValue(new Error('pool exhausted'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await POST(req());
      await settle();

      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ data: { id: 99 } });
      // Releasing it would let a retry book the same slot a second time.
      expect(idem.releaseIdempotencyKey).not.toHaveBeenCalled();
      expect(unpaid.scheduleUnpaidBookingCancel).toHaveBeenCalledWith(99);
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it('retries the completion once before giving up on it', async () => {
    (idem.completeIdempotencyKey as any)
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce(undefined);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await POST(req());
      expect(res.status).toBe(201);
      expect(idem.completeIdempotencyKey).toHaveBeenCalledTimes(2);
    } finally {
      logged.mockRestore();
    }
  });
});

describe('claiming a key', () => {
  it('hands the claim a way to ask whether this very request was already written', async () => {
    (lookup.findWrittenPublicAppointment as any).mockResolvedValue(55);
    await POST(req('k2'));

    const findWritten = (idem.claimIdempotencyKey as any).mock.calls[0][2] as () => Promise<number | null>;
    expect(typeof findWritten).toBe('function');
    await expect(findWritten()).resolves.toBe(55);
    expect(lookup.findWrittenPublicAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ professionalId: 7, date: '2026-09-20', startTime: '09:00' }),
    );
  });
});
