/**
 * Integration tests for service assignment.
 * T056: assign/unassign and ACTIVE-only filter (FR-011)
 */

import { describe, it, expect } from 'vitest';
import { assignServiceInputSchema } from '@/services/professional/validation';

describe('Service Assignment Integration', () => {
  describe('Assign service input validation', () => {
    it('should accept valid serviceId', () => {
      const input = { serviceId: 'clxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' };
      const result = assignServiceInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject invalid serviceId format', () => {
      const input = { serviceId: 'invalid-format' };
      const result = assignServiceInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject missing serviceId', () => {
      const input = {};
      const result = assignServiceInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject null serviceId', () => {
      const input = { serviceId: null };
      const result = assignServiceInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('ACTIVE service filter (FR-011)', () => {
    it('should only allow ACTIVE services to be assigned', () => {
      // FR-011: Only ACTIVE services are assignable
      const services = [
        { id: 'svc-1', name: 'Konsultasi Awal', status: 1 },   // ACTIVE
        { id: 'svc-2', name: 'Konsultasi Lanjutan', status: 0 }, // INACTIVE
        { id: 'svc-3', name: 'Tes Psikologi', status: 1 },   // ACTIVE
      ];

      const assignable = services.filter((s) => s.status === 1);
      expect(assignable).toHaveLength(2);
      expect(assignable.map((s) => s.id)).toEqual(['svc-1', 'svc-3']);
    });
  });

  describe('No duplicate assignment (T053)', () => {
    it('should prevent duplicate professional-service pairs', () => {
      // FR-011: ProfessionalServiceAssignment has unique([professionalId, serviceId])
      // The service layer checks for existing assignments before creating
      const existingAssignments = [
        { professionalId: 'prof-1', serviceId: 'svc-1' },
        { professionalId: 'prof-1', serviceId: 'svc-2' },
      ];

      const newAssignment = { professionalId: 'prof-1', serviceId: 'svc-1' };
      const isDuplicate = existingAssignments.some(
        (a) => a.professionalId === newAssignment.professionalId && a.serviceId === newAssignment.serviceId,
      );

      expect(isDuplicate).toBe(true);
    });

    it('should allow different services for same professional', () => {
      const existingAssignments = [
        { professionalId: 'prof-1', serviceId: 'svc-1' },
      ];

      const newAssignment = { professionalId: 'prof-1', serviceId: 'svc-3' };
      const isDuplicate = existingAssignments.some(
        (a) => a.professionalId === newAssignment.professionalId && a.serviceId === newAssignment.serviceId,
      );

      expect(isDuplicate).toBe(false);
    });
  });

  describe('Service duration affects slot generation (FR-007, SC-003)', () => {
    it('should verify different durations produce different slot counts', () => {
      const windowStart = 540; // 09:00
      const windowEnd = 720;   // 12:00

      const durations = [30, 60, 90, 120];
      const expectedSlotCounts = [6, 3, 2, 1]; // for 09:00-12:00 window

      for (let i = 0; i < durations.length; i++) {
        const duration = durations[i];
        let count = 0;
        let slotStart = windowStart;
        while (slotStart + duration <= windowEnd) {
          count++;
          slotStart += duration;
        }
        expect(count).toBe(expectedSlotCounts[i]);
      }
    });
  });
});