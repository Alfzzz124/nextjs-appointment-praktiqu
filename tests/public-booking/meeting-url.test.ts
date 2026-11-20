/**
 * Halaman janji temu klien: `meetingUrl` hanya untuk janji yang sudah pasti (BOOKED,
 * CHECK_IN). Janji yang belum pasti atau sudah batal tidak membagikan tautan, sekalipun
 * baris sinkronisasinya masih menyimpannya.
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
vi.mock('@/services/payments/public-usd.service', () => ({ rowPaymentForDisplay: vi.fn() }));
vi.mock('@/lib/logging', () => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));

const approval = vi.hoisted(() => ({ publicApprovalView: vi.fn() }));
vi.mock('@/services/approval/service', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/service')>()),
  publicApprovalView: (...a: unknown[]) => approval.publicApprovalView(...a),
}));

const sync = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { googleCalendarEventSync: { findMany: sync.findMany } } }));

import { findSessionById, SESSION_STATUS } from '@/repositories/wp/sessions.repo';
import { findServiceById } from '@/repositories/wp/services.repo';
import { resolveClinicPaymentForDisplay } from '@/services/payments/clinic-payment.service';
import { notInternational } from '@/services/payments/intl-pricing';
import { getPublicAppointmentById } from '@/services/public/public-booking.service';

const ID = 5150;
const MEET = 'https://meet.google.com/abc-defg-hij';

function row(status: string) {
  return {
    id: ID, clinicId: 3, professionalId: 29, clientId: 461,
    professionalName: 'Dr. Smith', clientName: 'Jane Doe', clientEmail: 'jane@test.local',
    slotDate: '2026-07-10', startTime: '10:00:00', endTime: '11:00:00',
    timezone: 'Asia/Jakarta', status, serviceIds: [7], description: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  approval.publicApprovalView.mockResolvedValue(null);
  vi.mocked(findServiceById).mockResolvedValue({ id: 7n, name: 'Consultation' } as never);
  vi.mocked(resolveClinicPaymentForDisplay).mockResolvedValue(notInternational(3));
  sync.findMany.mockResolvedValue([{ appointmentId: BigInt(ID), hangoutLink: MEET }]);
});

describe('getPublicAppointmentById — meetingUrl', () => {
  it.each([SESSION_STATUS.BOOKED, SESSION_STATUS.CHECK_IN])('membawa tautan untuk %s', async (status) => {
    vi.mocked(findSessionById).mockResolvedValue(row(status));

    expect((await getPublicAppointmentById(ID))?.meetingUrl).toBe(MEET);
  });

  it.each([SESSION_STATUS.PENDING, SESSION_STATUS.CANCELLED])('null untuk %s walau baris sinkronisasi menyimpan tautan', async (status) => {
    vi.mocked(findSessionById).mockResolvedValue(row(status));

    expect((await getPublicAppointmentById(ID))?.meetingUrl).toBeNull();
  });

  it('null untuk janji BOOKED tanpa baris sinkronisasi', async () => {
    vi.mocked(findSessionById).mockResolvedValue(row(SESSION_STATUS.BOOKED));
    sync.findMany.mockResolvedValue([]);

    expect((await getPublicAppointmentById(ID))?.meetingUrl).toBeNull();
  });
});
