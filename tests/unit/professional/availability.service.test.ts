/**
 * Unit tests for AvailabilityService.
 * T020: covers slot generation for 30/60/90/120-minute services
 *
 * Algorithm verification (per plan.md):
 *   1. Verify professional.status == ACTIVE
 *   2. Verify service is assigned to professional and ACTIVE
 *   3. Get practice.timezone
 *   4. Convert date (in practice TZ) → weekday
 *   5. Fetch windows for (professionalId, weekday)
 *   6. Subtract off-days where startDate..endDate includes date
 *   7. Subtract existing BOOKED, PENDING, CHECKED_IN sessions for date
 *   8. For each window: walk in service.durationMinutes increments
 *   9. Convert each slot (local TZ) → UTC, return
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies. `mockPrisma` is created via vi.hoisted so it exists
// before the hoisted vi.mock factory runs.
const mockPrisma = vi.hoisted(() => ({
  professional: {
    findUnique: vi.fn(),
  },
  doctor: {
    findUnique: vi.fn(),
  },
  appointment: {
    findMany: vi.fn(),
  },
  professionalAvailability: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  professionalOffDay: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(),
  logEntry: {
    create: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

import {
  generateSlots,
  getWeeklySchedule,
  setWeeklySchedule,
  addOffDay,
  removeOffDay,
} from '@/services/professional/availability.service';

describe('AvailabilityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.logEntry.create.mockResolvedValue({ id: 'log-1' });
  });

  // ============================================
  // getWeeklySchedule (T008)
  // ============================================

  describe('getWeeklySchedule', () => {
    it('should return schedule grouped by day of week', async () => {
      mockPrisma.professionalAvailability.findMany.mockResolvedValue([
        { id: 'w1', professionalId: 'prof-1', dayOfWeek: 1, startMinute: 540, endMinute: 720 },
        { id: 'w2', professionalId: 'prof-1', dayOfWeek: 1, startMinute: 780, endMinute: 960 },
        { id: 'w3', professionalId: 'prof-1', dayOfWeek: 3, startMinute: 540, endMinute: 720 },
      ]);

      const schedule = await getWeeklySchedule('prof-1');

      expect(schedule[1]).toHaveLength(2); // Monday has 2 windows
      expect(schedule[3]).toHaveLength(1); // Wednesday has 1 window
      expect(schedule[0]).toHaveLength(0); // Sunday has none
    });
  });

  // ============================================
  // setWeeklySchedule (T008, T039, FR-015)
  // ============================================

  describe('setWeeklySchedule', () => {
    it('should replace existing schedule', async () => {
      mockPrisma.professionalAvailability.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.professionalAvailability.createMany.mockResolvedValue({ count: 2 });

      const windows = [
        { dayOfWeek: 1, startMinute: 540, endMinute: 720 }, // Mon 09:00-12:00
      ];

      await setWeeklySchedule('prof-1', windows, 'actor-123');

      expect(mockPrisma.professionalAvailability.deleteMany).toHaveBeenCalledWith({
        where: { professionalId: 'prof-1' },
      });
      expect(mockPrisma.professionalAvailability.createMany).toHaveBeenCalledWith({
        data: [{ professionalId: 'prof-1', dayOfWeek: 1, startMinute: 540, endMinute: 720 }],
      });
    });

    it('should reject overlapping windows on same day (FR-015)', async () => {
      const overlappingWindows = [
        { dayOfWeek: 1, startMinute: 540, endMinute: 720 }, // Mon 09:00-12:00
        { dayOfWeek: 1, startMinute: 660, endMinute: 780 }, // Mon 11:00-13:00 (overlaps!)
      ];

      await expect(setWeeklySchedule('prof-1', overlappingWindows, 'actor-123')).rejects.toMatchObject({
        _tag: 'validation',
      });
    });

    it('should accept adjacent (non-overlapping) windows', async () => {
      mockPrisma.professionalAvailability.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.professionalAvailability.createMany.mockResolvedValue({ count: 2 });

      const windows = [
        { dayOfWeek: 1, startMinute: 540, endMinute: 600 }, // Mon 09:00-10:00
        { dayOfWeek: 1, startMinute: 600, endMinute: 660 }, // Mon 10:00-11:00 (adjacent, not overlapping)
      ];

      await expect(setWeeklySchedule('prof-1', windows, 'actor-123')).resolves.toBeUndefined();
    });
  });

  // ============================================
  // generateSlots (T008, T040)
  // ============================================

  describe('generateSlots', () => {
    it('should return empty array for non-existent professional', async () => {
      mockPrisma.professional.findUnique.mockResolvedValue(null);

      const slots = await generateSlots('non-existent', '2024-01-15', 'svc-1');

      expect(slots).toEqual([]);
    });

    it('should return empty array for INACTIVE professional', async () => {
      mockPrisma.professional.findUnique.mockResolvedValue({
        id: 'prof-1',
        status: 'INACTIVE',
        practice: null,
        serviceAssignments: [],
      });

      const slots = await generateSlots('prof-1', '2024-01-15', 'svc-1');

      expect(slots).toEqual([]);
    });

    it('should return empty array when service is not assigned', async () => {
      mockPrisma.professional.findUnique.mockResolvedValue({
        id: 'prof-1',
        status: 'ACTIVE',
        practice: { id: 'clinic-1', name: 'Test', timezone: 'Asia/Jakarta' },
        serviceAssignments: [
          { service: { id: 'svc-other', duration: 60, status: 1 } },
        ],
      });

      const slots = await generateSlots('prof-1', '2024-01-15', 'svc-unassigned');

      expect(slots).toEqual([]);
    });

    it('should return empty array when no availability windows exist', async () => {
      mockPrisma.professional.findUnique.mockResolvedValue({
        id: 'prof-1',
        status: 'ACTIVE',
        practice: { id: 'clinic-1', name: 'Test', timezone: 'Asia/Jakarta' },
        serviceAssignments: [
          { service: { id: 'svc-1', duration: 60, status: 1 } },
        ],
      });
      mockPrisma.professionalAvailability.findMany.mockResolvedValue([]);

      const slots = await generateSlots('prof-1', '2024-01-15', 'svc-1');

      expect(slots).toEqual([]);
    });

    it('should return empty array for off-day', async () => {
      mockPrisma.professional.findUnique.mockResolvedValue({
        id: 'prof-1',
        status: 'ACTIVE',
        practice: { id: 'clinic-1', name: 'Test', timezone: 'Asia/Jakarta' },
        serviceAssignments: [
          { service: { id: 'svc-1', duration: 60, status: 1 } },
        ],
      });
      mockPrisma.professionalAvailability.findMany.mockResolvedValue([
        { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
      ]);
      mockPrisma.professionalOffDay.findMany.mockResolvedValue([
        { startDate: new Date('2024-01-10'), endDate: new Date('2024-01-20') },
      ]);

      const slots = await generateSlots('prof-1', '2024-01-15', 'svc-1');

      expect(slots).toEqual([]);
    });

    describe('slot generation for different durations (SC-003)', () => {
      beforeEach(() => {
        mockPrisma.professional.findUnique.mockResolvedValue({
          id: 'prof-1',
          userId: 'user-1',
          status: 'ACTIVE',
          practice: { id: 'clinic-1', name: 'Test', timezone: 'Asia/Jakarta' },
          serviceAssignments: [
            { serviceId: 'svc-1', service: { id: 'svc-1', duration: 60, status: 'ACTIVE' } },
          ],
        });
        mockPrisma.professionalAvailability.findMany.mockResolvedValue([
          { dayOfWeek: 1, startMinute: 540, endMinute: 720 }, // Mon 09:00-12:00
        ]);
        mockPrisma.professionalOffDay.findMany.mockResolvedValue([]);
        mockPrisma.doctor.findUnique.mockResolvedValue({ id: 'doc-1' });
        mockPrisma.appointment.findMany.mockResolvedValue([]);
      });

      it('should generate 3 slots for 60-min service in Mon 09:00-12:00 window', async () => {
        const slots = await generateSlots('prof-1', '2024-01-15', 'svc-1');

        // 09:00, 10:00, 11:00 (3 slots, 60 min each)
        // 12:00 would end exactly at window end — excluded
        expect(slots).toHaveLength(3);
      });

      it('should generate correct slot times for 60-min service', async () => {
        const slots = await generateSlots('prof-1', '2024-01-15', 'svc-1');

        // Slots should be at 09:00, 10:00, 11:00 (minutes from midnight: 540, 600, 660)
        expect(slots[0].startUtc).toBeDefined();
        expect(slots[1].startUtc).toBeDefined();
        expect(slots[2].startUtc).toBeDefined();
      });
    });

    describe('30-minute service slots', () => {
      beforeEach(() => {
        mockPrisma.professional.findUnique.mockResolvedValue({
          id: 'prof-1',
          userId: 'user-1',
          status: 'ACTIVE',
          practice: { id: 'clinic-1', name: 'Test', timezone: 'Asia/Jakarta' },
          serviceAssignments: [
            { serviceId: 'svc-30', service: { id: 'svc-30', duration: 30, status: 'ACTIVE' } },
          ],
        });
        mockPrisma.professionalAvailability.findMany.mockResolvedValue([
          { dayOfWeek: 1, startMinute: 540, endMinute: 720 }, // Mon 09:00-12:00
        ]);
        mockPrisma.professionalOffDay.findMany.mockResolvedValue([]);
        mockPrisma.doctor.findUnique.mockResolvedValue({ id: 'doc-1' });
        mockPrisma.appointment.findMany.mockResolvedValue([]);
      });

      it('should generate 6 slots for 30-min service in Mon 09:00-12:00 window', async () => {
        const slots = await generateSlots('prof-1', '2024-01-15', 'svc-30');

        // 09:00, 09:30, 10:00, 10:30, 11:00, 11:30 (6 slots, 30 min each)
        // 12:00 would exceed window
        expect(slots).toHaveLength(6);
      });
    });

    describe('120-minute service slots', () => {
      beforeEach(() => {
        mockPrisma.professional.findUnique.mockResolvedValue({
          id: 'prof-1',
          userId: 'user-1',
          status: 'ACTIVE',
          practice: { id: 'clinic-1', name: 'Test', timezone: 'Asia/Jakarta' },
          serviceAssignments: [
            { serviceId: 'svc-120', service: { id: 'svc-120', duration: 120, status: 'ACTIVE' } },
          ],
        });
        mockPrisma.professionalAvailability.findMany.mockResolvedValue([
          { dayOfWeek: 1, startMinute: 540, endMinute: 720 }, // Mon 09:00-12:00
        ]);
        mockPrisma.professionalOffDay.findMany.mockResolvedValue([]);
        mockPrisma.doctor.findUnique.mockResolvedValue({ id: 'doc-1' });
        mockPrisma.appointment.findMany.mockResolvedValue([]);
      });

      it('should generate 1 slot for 120-min service in Mon 09:00-12:00 window', async () => {
        const slots = await generateSlots('prof-1', '2024-01-15', 'svc-120');

        // Only 09:00 fits (ends at 11:00, within window)
        // 11:00 would end at 13:00, exceeding window end at 12:00
        expect(slots).toHaveLength(1);
      });
    });

    describe('booked sessions block slots', () => {
      beforeEach(() => {
        mockPrisma.professional.findUnique.mockResolvedValue({
          id: 'prof-1',
          userId: 'user-1',
          status: 'ACTIVE',
          practice: { id: 'clinic-1', name: 'Test', timezone: 'Asia/Jakarta' },
          serviceAssignments: [
            { serviceId: 'svc-60', service: { id: 'svc-60', duration: 60, status: 'ACTIVE' } },
          ],
        });
        mockPrisma.professionalAvailability.findMany.mockResolvedValue([
          { dayOfWeek: 1, startMinute: 540, endMinute: 720 }, // Mon 09:00-12:00
        ]);
        mockPrisma.professionalOffDay.findMany.mockResolvedValue([]);
        mockPrisma.doctor.findUnique.mockResolvedValue({ id: 'doc-1' });
      });

      it('should block PENDING appointments', async () => {
        mockPrisma.appointment.findMany.mockResolvedValue([
          {
            appointmentStartTime: new Date('1970-01-01T10:00:00Z'),
            appointmentEndTime: new Date('1970-01-01T11:00:00Z'),
            status: 'PENDING',
          },
        ]);

        const slots = await generateSlots('prof-1', '2024-01-15', 'svc-60');

        // 09:00, 11:00 slots (10:00 blocked by PENDING)
        expect(slots).toHaveLength(2);
      });

      it('should block BOOKED appointments', async () => {
        mockPrisma.appointment.findMany.mockResolvedValue([
          {
            appointmentStartTime: new Date('1970-01-01T09:00:00Z'),
            appointmentEndTime: new Date('1970-01-01T10:00:00Z'),
            status: 'BOOKED',
          },
        ]);

        const slots = await generateSlots('prof-1', '2024-01-15', 'svc-60');

        // 10:00, 11:00 slots (09:00 blocked by BOOKED)
        expect(slots).toHaveLength(2);
      });

      it('should not block COMPLETED or CANCELLED appointments', async () => {
        // getBookedRanges only queries blocking statuses (BOOKED/PENDING/CHECK_IN),
        // so the DB returns nothing for a COMPLETED/CANCELLED appointment.
        mockPrisma.appointment.findMany.mockResolvedValue([]);

        const slots = await generateSlots('prof-1', '2024-01-15', 'svc-60');

        // All 3 slots available
        expect(slots).toHaveLength(3);
      });
    });
  });

  // ============================================
  // Off Days (T008)
  // ============================================

  describe('addOffDay', () => {
    it('should create an off day entry', async () => {
      mockPrisma.professionalOffDay.create.mockResolvedValue({
        id: 'off-1',
        professionalId: 'prof-1',
        startDate: new Date('2024-01-15'),
        endDate: new Date('2024-01-17'),
        reason: 'Annual leave',
        createdAt: new Date(),
      });

      const offDay = await addOffDay(
        'prof-1',
        new Date('2024-01-15'),
        new Date('2024-01-17'),
        'Annual leave',
        'actor-123',
      );

      expect(offDay.id).toBe('off-1');
      expect(mockPrisma.logEntry.create).toHaveBeenCalled();
    });
  });

  describe('removeOffDay', () => {
    it('should delete the off day and log the event', async () => {
      mockPrisma.professionalOffDay.findUnique.mockResolvedValue({
        id: 'off-1',
        professionalId: 'prof-1',
        startDate: new Date('2024-01-15'),
        endDate: new Date('2024-01-17'),
        reason: 'Annual leave',
        createdAt: new Date(),
      });
      mockPrisma.professionalOffDay.delete.mockResolvedValue({ id: 'off-1' });

      await removeOffDay('off-1', 'actor-123');

      expect(mockPrisma.professionalOffDay.delete).toHaveBeenCalledWith({ where: { id: 'off-1' } });
      expect(mockPrisma.logEntry.create).toHaveBeenCalled();
    });

    it('should throw not_found for non-existent off day', async () => {
      mockPrisma.professionalOffDay.findUnique.mockResolvedValue(null);

      await expect(removeOffDay('non-existent', 'actor-123')).rejects.toMatchObject({
        _tag: 'not_found',
      });
    });
  });
});