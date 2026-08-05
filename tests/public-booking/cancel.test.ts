/**
 * Public appointment lookup + cancel, against KiviCare's tables.
 *
 * Cancellable states are PENDING and BOOKED; CANCELLED, CHECK_IN and CHECK_OUT are
 * not. The write goes through the plugin — a raw UPDATE would skip the cancellation
 * email and the telemed teardown, and CANCELLED is 0, not 1.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/repositories/wp/sessions.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/sessions.repo')>()),
  findSessionById: vi.fn(),
}));
vi.mock('@/repositories/wp/services.repo', () => ({
  findServiceById: vi.fn(),
  listServicesForDoctor: vi.fn(),
}));
vi.mock('@/repositories/wp/appointments.write', () => ({
  cancelAppointment: vi.fn(),
  createAppointment: vi.fn(),
}));

import { findSessionById, SESSION_STATUS } from '@/repositories/wp/sessions.repo';
import { findServiceById } from '@/repositories/wp/services.repo';
import { cancelAppointment } from '@/repositories/wp/appointments.write';
import {
  cancelPublicAppointment,
  getPublicAppointmentById,
  NotCancellableError,
  AppointmentNotFoundError,
} from '@/services/public/public-booking.service';

const APPOINTMENT = 5150;

function row(status: string) {
  return {
    id: APPOINTMENT,
    clinicId: 3,
    professionalId: 29,
    clientId: 461,
    professionalName: 'Dr. Smith',
    clientName: 'Jane Doe',
    clientEmail: 'jane@test.local',
    slotDate: '2026-07-10',
    startTime: '10:00:00',
    endTime: '11:00:00',
    timezone: 'Asia/Jakarta',
    status,
    serviceIds: [7],
    description: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findServiceById).mockResolvedValue({ id: 7n, name: 'Consultation' } as never);
});

describe('getPublicAppointmentById', () => {
  it('returns null when no row exists', async () => {
    vi.mocked(findSessionById).mockResolvedValue(null);
    expect(await getPublicAppointmentById(404404)).toBeNull();
  });

  it('maps a row to the public view', async () => {
    vi.mocked(findSessionById).mockResolvedValue(row(SESSION_STATUS.PENDING));

    expect(await getPublicAppointmentById(APPOINTMENT)).toEqual({
      id: APPOINTMENT,
      status: 'PENDING',
      date: '2026-07-10',
      // Trimmed from KiviCare's HH:MM:SS — the guest sees a wall-clock time.
      startTime: '10:00',
      service: 'Consultation',
      professionalName: 'Dr. Smith',
      clientName: 'Jane Doe',
    });
  });

  it('names the service from the ids KiviCare joins into visit_type', async () => {
    vi.mocked(findSessionById).mockResolvedValue(row(SESSION_STATUS.BOOKED));
    await getPublicAppointmentById(APPOINTMENT);
    expect(findServiceById).toHaveBeenCalledWith(7n);
  });

  it('falls back to a generic label when the booking carries no service', async () => {
    vi.mocked(findSessionById).mockResolvedValue({
      ...(row(SESSION_STATUS.BOOKED) as object),
      serviceIds: [],
    } as never);

    const view = await getPublicAppointmentById(APPOINTMENT);
    expect(view!.service).toBe('Service');
    expect(findServiceById).not.toHaveBeenCalled();
  });
});

describe('cancelPublicAppointment', () => {
  it('throws NotCancellableError when the row is already cancelled', async () => {
    vi.mocked(findSessionById).mockResolvedValue(row(SESSION_STATUS.CANCELLED));

    await expect(cancelPublicAppointment(APPOINTMENT)).rejects.toBeInstanceOf(
      NotCancellableError,
    );
    expect(cancelAppointment).not.toHaveBeenCalled();
  });

  it('throws NotCancellableError for a finished (CHECK_OUT) appointment', async () => {
    vi.mocked(findSessionById).mockResolvedValue(row(SESSION_STATUS.CHECK_OUT));
    await expect(cancelPublicAppointment(APPOINTMENT)).rejects.toBeInstanceOf(
      NotCancellableError,
    );
  });

  it('throws NotCancellableError once the client has checked in', async () => {
    vi.mocked(findSessionById).mockResolvedValue(row(SESSION_STATUS.CHECK_IN));
    await expect(cancelPublicAppointment(APPOINTMENT)).rejects.toBeInstanceOf(
      NotCancellableError,
    );
  });

  it('throws AppointmentNotFoundError when no row exists', async () => {
    vi.mocked(findSessionById).mockResolvedValue(null);
    await expect(cancelPublicAppointment(404404)).rejects.toBeInstanceOf(
      AppointmentNotFoundError,
    );
  });

  it('cancels a BOOKED appointment through the plugin', async () => {
    vi.mocked(findSessionById)
      .mockResolvedValueOnce(row(SESSION_STATUS.BOOKED))
      .mockResolvedValueOnce(row(SESSION_STATUS.CANCELLED));

    const result = await cancelPublicAppointment(APPOINTMENT);

    expect(cancelAppointment).toHaveBeenCalledWith(APPOINTMENT);
    expect(result.status).toBe('CANCELLED');
  });

  it('cancels a PENDING appointment', async () => {
    vi.mocked(findSessionById)
      .mockResolvedValueOnce(row(SESSION_STATUS.PENDING))
      .mockResolvedValueOnce(row(SESSION_STATUS.CANCELLED));

    expect((await cancelPublicAppointment(APPOINTMENT)).status).toBe('CANCELLED');
  });
});
