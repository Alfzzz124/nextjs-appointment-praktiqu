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
vi.mock('@/services/payments/clinic-payment.service', () => ({
  resolveClinicPaymentForDisplay: vi.fn(),
}));
vi.mock('@/services/payments/public-usd.service', () => ({
  rowPaymentForDisplay: vi.fn(),
}));
vi.mock('@/lib/logging', () => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));

const approval = vi.hoisted(() => ({ closeOnCancel: vi.fn(), publicApprovalView: vi.fn() }));
vi.mock('@/services/approval/service', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/service')>()),
  closeOnCancel: (...a: unknown[]) => approval.closeOnCancel(...a),
  publicApprovalView: (...a: unknown[]) => approval.publicApprovalView(...a),
}));

import { findSessionById, SESSION_STATUS } from '@/repositories/wp/sessions.repo';
import { findServiceById, listServicesForDoctor } from '@/repositories/wp/services.repo';
import { cancelAppointment } from '@/repositories/wp/appointments.write';
import { resolveClinicPaymentForDisplay } from '@/services/payments/clinic-payment.service';
import { rowPaymentForDisplay } from '@/services/payments/public-usd.service';
import { notInternational, type ClinicPaymentSettings } from '@/services/payments/intl-pricing';
import { logging } from '@/lib/logging';
import {
  cancelPublicAppointment,
  getPublicAppointmentById,
  NotCancellableError,
  AppointmentNotFoundError,
} from '@/services/public/public-booking.service';

beforeEach(() => {
  approval.closeOnCancel.mockReset().mockResolvedValue(false);
  approval.publicApprovalView.mockReset().mockResolvedValue(null);
});

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
  vi.mocked(resolveClinicPaymentForDisplay).mockResolvedValue(notInternational(3));
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
      clinicId: 3,
      paymentMethods: ['xendit'],
      usd: null,
      approval: null,
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

describe('public appointment view — payment fields', () => {
  const INTL: ClinicPaymentSettings = { ...notInternational(3), international: true, methods: ['xendit', 'paypal', 'card'] };

  it('runs no mapping or tax query for a clinic that cannot take PayPal', async () => {
    vi.mocked(findSessionById).mockResolvedValue(row(SESSION_STATUS.PENDING));

    const view = await getPublicAppointmentById(APPOINTMENT);

    expect(resolveClinicPaymentForDisplay).toHaveBeenCalledWith(3);
    expect(listServicesForDoctor).not.toHaveBeenCalled();
    expect(rowPaymentForDisplay).not.toHaveBeenCalled();
    expect(view).toMatchObject({ paymentMethods: ['xendit'], usd: null });
  });

  it("prices an international booking from the doctor's own charge at the booked clinic", async () => {
    vi.mocked(findSessionById).mockResolvedValue(row(SESSION_STATUS.PENDING));
    vi.mocked(resolveClinicPaymentForDisplay).mockResolvedValue(INTL);
    vi.mocked(listServicesForDoctor).mockResolvedValue([
      { serviceId: 8n, name: 'Other', nameAlias: null, charges: '1' },
      { serviceId: 7n, name: 'Consultation', nameAlias: 'konseling', charges: '350000' },
    ] as never);
    const usd = { price: '21.39', taxes: [], fee: null, total: '21.39' };
    vi.mocked(rowPaymentForDisplay).mockResolvedValue({ paymentMethods: ['xendit', 'paypal', 'card'], usd });

    const view = await getPublicAppointmentById(APPOINTMENT);

    expect(listServicesForDoctor).toHaveBeenCalledWith({ doctorId: 29n, clinicId: 3n });
    expect(rowPaymentForDisplay).toHaveBeenCalledWith(
      { clinicId: 3, doctorId: 29, serviceId: 7, name: 'Consultation', price: '350000' },
      INTL,
    );
    expect(view).toMatchObject({ paymentMethods: ['xendit', 'paypal', 'card'], usd });
  });

  it('offers Xendit only when the booked service is no longer mapped', async () => {
    vi.mocked(findSessionById).mockResolvedValue(row(SESSION_STATUS.PENDING));
    vi.mocked(resolveClinicPaymentForDisplay).mockResolvedValue(INTL);
    vi.mocked(listServicesForDoctor).mockResolvedValue([]);

    const view = await getPublicAppointmentById(APPOINTMENT);

    expect(rowPaymentForDisplay).not.toHaveBeenCalled();
    expect(view).toMatchObject({ paymentMethods: ['xendit'], usd: null });
  });

  it('answers a cancel that went through with Xendit only, and logs, when the mapping read fails', async () => {
    vi.mocked(findSessionById)
      .mockResolvedValueOnce(row(SESSION_STATUS.PENDING))
      .mockResolvedValueOnce(row(SESSION_STATUS.CANCELLED));
    vi.mocked(resolveClinicPaymentForDisplay).mockResolvedValue(INTL);
    const dbDown = new Error('Too many connections');
    vi.mocked(listServicesForDoctor).mockRejectedValue(dbDown);

    const view = await cancelPublicAppointment(APPOINTMENT);

    expect(cancelAppointment).toHaveBeenCalledWith(APPOINTMENT);
    expect(view).toMatchObject({ status: 'CANCELLED', paymentMethods: ['xendit'], usd: null });
    expect(rowPaymentForDisplay).not.toHaveBeenCalled();
    expect(logging.error).toHaveBeenCalledWith('USD price unavailable — showing rupiah and Xendit only', dbDown, {
      resource: 'clinic',
      resourceId: '3',
      metadata: { doctorId: 29, serviceId: 7 },
    });
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

describe('psychologist approval', () => {
  it('the public view carries the approval state', async () => {
    const view = {
      state: 'AWAITING',
      requestedAt: '2026-10-20T02:00:00.000Z',
      decidedAt: null,
      refundStatus: 'NONE',
      isOverdue: false,
    };
    vi.mocked(findSessionById).mockResolvedValue(row(SESSION_STATUS.PENDING));
    approval.publicApprovalView.mockResolvedValue(view);

    expect((await getPublicAppointmentById(APPOINTMENT))?.approval).toEqual(view);
  });

  it('a client cancelling a booking that waits for approval puts it on the refund list', async () => {
    vi.mocked(findSessionById).mockResolvedValue(row(SESSION_STATUS.PENDING));

    await cancelPublicAppointment(APPOINTMENT);

    expect(approval.closeOnCancel).toHaveBeenCalledWith(APPOINTMENT, null);
  });
});
