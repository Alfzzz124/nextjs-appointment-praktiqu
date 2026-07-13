/**
 * Public appointment lookup + cancel — app-table (Prisma) contract.
 * Cancellable states: PENDING, BOOKED. CANCELLED/CHECK_IN/CHECK_OUT are not.
 * (Replaces the old wp_kc_* raw-SQL contract; status is the Prisma enum now.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    appointment: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import {
  cancelPublicAppointment,
  getPublicAppointmentById,
  NotCancellableError,
  AppointmentNotFoundError,
} from '@/services/public/public-booking.service';

const p = prisma as any;

const VIEW_ROW = {
  id: 'appt-1',
  status: 'CANCELLED',
  appointmentStartDate: new Date('2026-07-10T00:00:00.000Z'),
  appointmentStartTime: new Date('1970-01-01T10:00:00.000Z'),
  doctor: { user: { displayName: 'Dr. Smith' } },
  patient: { user: { displayName: 'Jane Doe' } },
  services: [{ service: { name: 'Consultation' } }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getPublicAppointmentById', () => {
  it('returns null when no row exists', async () => {
    p.appointment.findUnique.mockResolvedValue(null);
    expect(await getPublicAppointmentById('missing')).toBeNull();
  });

  it('maps a row to the public view', async () => {
    p.appointment.findUnique.mockResolvedValue({ ...VIEW_ROW, status: 'PENDING' });
    const view = await getPublicAppointmentById('appt-1');
    expect(view).toEqual({
      id: 'appt-1',
      status: 'PENDING',
      date: '2026-07-10',
      startTime: '10:00',
      service: 'Consultation',
      professionalName: 'Dr. Smith',
      clientName: 'Jane Doe',
    });
    expect(p.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('cancelPublicAppointment', () => {
  it('throws NotCancellableError when the row is already cancelled', async () => {
    p.appointment.findUnique.mockResolvedValue({ ...VIEW_ROW, status: 'CANCELLED' });
    await expect(cancelPublicAppointment('appt-1')).rejects.toBeInstanceOf(NotCancellableError);
    expect(p.appointment.update).not.toHaveBeenCalled();
  });

  it('throws NotCancellableError for a finished (CHECK_OUT) appointment', async () => {
    p.appointment.findUnique.mockResolvedValue({ ...VIEW_ROW, status: 'CHECK_OUT' });
    await expect(cancelPublicAppointment('appt-1')).rejects.toBeInstanceOf(NotCancellableError);
  });

  it('throws AppointmentNotFoundError when no row exists', async () => {
    p.appointment.findUnique.mockResolvedValue(null);
    await expect(cancelPublicAppointment('missing')).rejects.toBeInstanceOf(
      AppointmentNotFoundError,
    );
  });

  it('cancels a BOOKED appointment — updates status to CANCELLED', async () => {
    p.appointment.findUnique
      .mockResolvedValueOnce({ ...VIEW_ROW, status: 'BOOKED' })
      .mockResolvedValueOnce({ ...VIEW_ROW, status: 'CANCELLED' });
    p.appointment.update.mockResolvedValue({});

    const result = await cancelPublicAppointment('appt-1');

    expect(p.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appt-1' },
        data: { status: 'CANCELLED' },
      }),
    );
    expect(result.status).toBe('CANCELLED');
  });

  it('cancels a PENDING appointment — updates status to CANCELLED', async () => {
    p.appointment.findUnique
      .mockResolvedValueOnce({ ...VIEW_ROW, status: 'PENDING' })
      .mockResolvedValueOnce({ ...VIEW_ROW, status: 'CANCELLED' });
    p.appointment.update.mockResolvedValue({});

    const result = await cancelPublicAppointment('appt-1');
    expect(result.status).toBe('CANCELLED');
  });
});
