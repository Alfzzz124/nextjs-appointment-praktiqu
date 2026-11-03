import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertTestDb, seedClinicAdmin, seedAppointment, seedBill, cleanup, useIdBlock } from './fixtures';
import {
  getStatistics, getRecentPayments, getTopProfessionals,
  getUpcomingSessions, getRevenueChart,
} from '@/services/billing/dashboard.service';

const { BASE } = useIdBlock('billing/dashboard.service.test.ts');

const CLINIC = BASE + 1, ADMIN = BASE + 2;
const DOCTOR = BASE + 10, PATIENT_A = BASE + 20, PATIENT_B = BASE + 21;

const scopeClinic = { clinicId: BigInt(CLINIC) };
const params = { limit: 10, period: 'month' as const };

describe('dashboard.service', () => {
  describe('DB-backed aggregates', () => {
    beforeAll(async () => {
      assertTestDb();
      await cleanup();
      await seedClinicAdmin({ userId: ADMIN, clinicId: CLINIC });

      // Three appointments in-scope: two active (BOOKED/PENDING), one cancelled.
      // Upcoming dates are in the future so getUpcomingSessions picks them up.
      await seedAppointment({ id: BASE + 400, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT_A, status: 1, startDate: '2027-01-10' });
      await seedAppointment({ id: BASE + 401, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT_B, status: 2, startDate: '2027-01-11' });
      await seedAppointment({ id: BASE + 402, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT_A, status: 0, startDate: '2027-01-12' });

      // Two bills in-scope (clinic_id = CLINIC), total revenue 300.00.
      await seedBill({ id: BASE + 600, clinicId: CLINIC, actualAmount: '100.00', createdAt: '2026-07-10 12:00:00' });
      await seedBill({ id: BASE + 601, clinicId: CLINIC, actualAmount: '200.00', createdAt: '2026-08-10 12:00:00' });

      // One in-scope UNPAID bill: billed, but not revenue.
      await seedBill({ id: BASE + 603, clinicId: CLINIC, actualAmount: '50.00', createdAt: '2026-08-12 12:00:00', paymentStatus: 'unpaid' });

      // One out-of-scope bill (different clinic) that must NOT count.
      await seedBill({ id: BASE + 602, clinicId: CLINIC + 999, actualAmount: '999.00', createdAt: '2026-07-15 12:00:00' });
    });
    afterAll(cleanup);

    it('getStatistics returns scoped counts + revenue', async () => {
      const stats = await getStatistics(params, scopeClinic);
      expect(stats.appointments).toBe(3);
      expect(stats.active_appointments).toBe(2);
      expect(stats.patients).toBe(2);
      expect(stats.bills).toBe(3);
      expect(stats.paid_bills).toBe(2);
      // Revenue is money received: the unpaid 50.00 is billed, not earned.
      expect(stats.revenue).toBe(300);
      expect(stats.billed).toBe(350);
    });

    it('getTopProfessionals returns scoped rows', async () => {
      const { professionals } = await getTopProfessionals(params, scopeClinic);
      const row = professionals.find((p) => p.doctor_id === DOCTOR);
      expect(row).toBeDefined();
      expect(row!.appointments).toBe(3);
    });

    it('getUpcomingSessions returns future BOOKED/PENDING appointments', async () => {
      const { sessions } = await getUpcomingSessions(params, scopeClinic);
      const ids = sessions.map((s) => s.id);
      expect(ids).toContain(BASE + 400);
      expect(ids).toContain(BASE + 401);
      // cancelled appointment excluded
      expect(ids).not.toContain(BASE + 402);
    });

    it('getRecentPayments returns scoped bills only', async () => {
      const { payments } = await getRecentPayments(params, scopeClinic);
      const ids = payments.map((p) => p.id);
      expect(ids).toContain(BASE + 600);
      expect(ids).toContain(BASE + 601);
      expect(ids).not.toContain(BASE + 602);
    });

    it('getRevenueChart buckets scoped revenue', async () => {
      const { chart } = await getRevenueChart(params, scopeClinic);
      const total = chart.reduce((sum, c) => sum + c.revenue, 0);
      expect(total).toBe(300);
      expect(chart.reduce((sum, c) => sum + c.billed, 0)).toBe(350);
      expect(chart.some((c) => c.bucket === '2026-07')).toBe(true);
      expect(chart.some((c) => c.bucket === '2026-08')).toBe(true);
    });
  });
});
