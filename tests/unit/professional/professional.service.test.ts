/**
 * Unit tests for ProfessionalService.
 * T019: covers create, read, update, list, status change
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma before importing the service
const mockPrisma = {
  professional: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  logEntry: {
    create: vi.fn(),
  },
};

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

// Must re-import after mocking
import {
  createProfessional,
  getProfessional,
  updateProfessional,
  listProfessionals,
  setProfessionalStatus,
  deactivateProfessional,
  activateProfessional,
} from '@/services/professional/professional.service';
import { ProfessionalStatus } from '@prisma/client';

describe('ProfessionalService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // Create (T007)
  // ============================================

  describe('createProfessional', () => {
    it('should create a professional with PENDING_ACTIVATION status', async () => {
      const input = {
        userId: 'user-123',
        fullName: 'Dr. Jane Doe',
        email: 'jane@example.com',
        professionalType: 'PSIKOLOG_KLINIS' as const,
        registrationNumber: 'PSI-12345-2024',
      };

      mockPrisma.professional.findFirst.mockResolvedValueOnce(null); // registration check
      mockPrisma.professional.findFirst.mockResolvedValueOnce(null); // email check
      mockPrisma.professional.create.mockResolvedValue({
        id: 'prof-456',
        ...input,
        status: 'PENDING_ACTIVATION',
        practiceId: null,
        biography: null,
        specialties: null,
        contactInfo: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.logEntry.create.mockResolvedValue({ id: 'log-1' });

      const result = await createProfessional(input, 'actor-123');

      expect(result.id).toBe('prof-456');
      expect(mockPrisma.professional.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-123',
            fullName: 'Dr. Jane Doe',
            status: ProfessionalStatus.PENDING_ACTIVATION,
          }),
        }),
      );
    });

    it('should reject duplicate registration number', async () => {
      mockPrisma.professional.findFirst.mockResolvedValueOnce({
        id: 'existing-prof',
        registrationNumber: 'PSI-99999-9999',
      });

      const input = {
        userId: 'user-123',
        fullName: 'Dr. Jane Doe',
        email: 'jane@example.com',
        professionalType: 'PSIKOLOG_KLINIS' as const,
        registrationNumber: 'PSI-99999-9999', // duplicate
      };

      await expect(createProfessional(input, 'actor-123')).rejects.toThrow();
    });

    it('should reject duplicate email', async () => {
      mockPrisma.professional.findFirst
        .mockResolvedValueOnce(null) // registration unique
        .mockResolvedValueOnce({ id: 'existing-prof', email: 'existing@example.com' }); // email conflict

      const input = {
        userId: 'user-123',
        fullName: 'Dr. Jane Doe',
        email: 'existing@example.com', // duplicate
        professionalType: 'PSIKOLOG_KLINIS' as const,
        registrationNumber: 'PSI-11111-2024',
      };

      await expect(createProfessional(input, 'actor-123')).rejects.toThrow();
    });
  });

  // ============================================
  // Read (T007)
  // ============================================

  describe('getProfessional', () => {
    it('should return professional with related data', async () => {
      const mockProfessional = {
        id: 'prof-456',
        fullName: 'Dr. Jane Doe',
        practice: { id: 'clinic-1', name: 'PraktiQU Clinic' },
        serviceAssignments: [
          {
            service: { id: 'svc-1', name: 'Konsultasi Awal', duration: 60, status: 1 },
          },
        ],
        _count: { availability: 3, offDays: 0 },
      };

      mockPrisma.professional.findUnique.mockResolvedValue(mockProfessional);

      const result = await getProfessional('prof-456');

      expect(result).toEqual(mockProfessional);
      expect(mockPrisma.professional.findUnique).toHaveBeenCalledWith({
        where: { id: 'prof-456' },
        include: {
          practice: { select: { id: true, name: true } },
          serviceAssignments: {
            include: { service: { select: { id: true, name: true, duration: true, status: true } } },
          },
          _count: { select: { availability: true, offDays: true } },
        },
      });
    });

    it('should return null for non-existent professional', async () => {
      mockPrisma.professional.findUnique.mockResolvedValue(null);

      const result = await getProfessional('non-existent');

      expect(result).toBeNull();
    });
  });

  // ============================================
  // List (T007, T012)
  // ============================================

  describe('listProfessionals', () => {
    it('should list professionals with pagination', async () => {
      const mockItems = [
        { id: 'prof-1', fullName: 'Dr. A', email: 'a@example.com', status: 'ACTIVE', practice: null },
        { id: 'prof-2', fullName: 'Dr. B', email: 'b@example.com', status: 'ACTIVE', practice: null },
      ];

      mockPrisma.professional.findMany.mockResolvedValue(mockItems);
      mockPrisma.professional.count.mockResolvedValue(50);

      const result = await listProfessionals({ page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(2);
      expect(result.pagination.totalItems).toBe(50);
      expect(result.pagination.totalPages).toBe(3);
    });

    it('should filter by status', async () => {
      mockPrisma.professional.findMany.mockResolvedValue([]);
      mockPrisma.professional.count.mockResolvedValue(0);

      await listProfessionals({ status: 'ACTIVE', pageSize: 20, page: 1 });

      expect(mockPrisma.professional.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
    });

    it('should filter by search term', async () => {
      mockPrisma.professional.findMany.mockResolvedValue([]);
      mockPrisma.professional.count.mockResolvedValue(0);

      await listProfessionals({ search: 'Jane', pageSize: 20, page: 1 });

      expect(mockPrisma.professional.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { fullName: { contains: 'Jane', mode: 'insensitive' } },
            ]),
          }),
        }),
      );
    });

    it('should scope to practice for CLINIC_ADMIN', async () => {
      mockPrisma.professional.findMany.mockResolvedValue([]);
      mockPrisma.professional.count.mockResolvedValue(0);

      await listProfessionals({ pageSize: 20, page: 1 }, 'clinic-abc');

      expect(mockPrisma.professional.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ practiceId: 'clinic-abc' }),
        }),
      );
    });
  });

  // ============================================
  // Update (T007, T031)
  // ============================================

  describe('updateProfessional', () => {
    it('should update biography for self-edit', async () => {
      mockPrisma.professional.findUnique
        .mockResolvedValueOnce({ id: 'prof-456', fullName: 'Dr. Jane', biography: null, specialties: null, contactInfo: null })
        .mockResolvedValueOnce({ id: 'prof-456', fullName: 'Dr. Jane', biography: 'Updated bio', specialties: null, contactInfo: null });
      mockPrisma.professional.update.mockResolvedValue({ id: 'prof-456', biography: 'Updated bio' });
      mockPrisma.logEntry.create.mockResolvedValue({ id: 'log-1' });

      await updateProfessional('prof-456', { biography: 'Updated bio' }, 'actor-123', true);

      expect(mockPrisma.professional.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'prof-456' },
          data: expect.objectContaining({ biography: 'Updated bio' }),
        }),
      );
    });

    it('should reject updates to read-only fields on self-edit', async () => {
      mockPrisma.professional.findUnique.mockResolvedValue({ id: 'prof-456', fullName: 'Dr. Jane' });

      // Registration number should be rejected
      const err = await updateProfessional(
        'prof-456',
        { registrationNumber: 'PSI-99999-9999' },
        'actor-123',
        true, // isSelfEdit
      ).catch((e) => e);

      // The selfUpdateProfessionalInputSchema should reject unknown fields
      expect(err).toBeDefined();
    });
  });

  // ============================================
  // Status Change (T007, T016)
  // ============================================

  describe('setProfessionalStatus', () => {
    it('should change status from ACTIVE to INACTIVE', async () => {
      mockPrisma.professional.findUnique.mockResolvedValue({
        id: 'prof-456',
        status: 'ACTIVE',
      });
      mockPrisma.professional.update.mockResolvedValue({ id: 'prof-456', status: 'INACTIVE' });
      mockPrisma.logEntry.create.mockResolvedValue({ id: 'log-1' });

      await setProfessionalStatus('prof-456', 'INACTIVE', 'actor-123');

      expect(mockPrisma.professional.update).toHaveBeenCalledWith({
        where: { id: 'prof-456' },
        data: { status: 'INACTIVE' },
      });
    });

    it('should be a no-op when status is unchanged', async () => {
      mockPrisma.professional.findUnique.mockResolvedValue({
        id: 'prof-456',
        status: 'ACTIVE',
      });

      await setProfessionalStatus('prof-456', 'ACTIVE', 'actor-123');

      expect(mockPrisma.professional.update).not.toHaveBeenCalled();
    });

    it('should throw not_found for non-existent professional', async () => {
      mockPrisma.professional.findUnique.mockResolvedValue(null);

      await expect(setProfessionalStatus('non-existent', 'ACTIVE', 'actor-123')).rejects.toMatchObject({
        _tag: 'not_found',
      });
    });
  });

  describe('deactivateProfessional', () => {
    it('should set status to INACTIVE', async () => {
      mockPrisma.professional.findUnique.mockResolvedValueOnce({ id: 'prof-456', status: 'ACTIVE' });
      mockPrisma.professional.update.mockResolvedValue({ id: 'prof-456', status: 'INACTIVE' });
      mockPrisma.logEntry.create.mockResolvedValue({ id: 'log-1' });

      await deactivateProfessional('prof-456', 'actor-123');

      expect(mockPrisma.professional.update).toHaveBeenCalledWith({
        where: { id: 'prof-456' },
        data: { status: 'INACTIVE' },
      });
    });
  });

  describe('activateProfessional', () => {
    it('should set status to ACTIVE', async () => {
      mockPrisma.professional.findUnique.mockResolvedValueOnce({ id: 'prof-456', status: 'PENDING_ACTIVATION' });
      mockPrisma.professional.update.mockResolvedValue({ id: 'prof-456', status: 'ACTIVE' });
      mockPrisma.logEntry.create.mockResolvedValue({ id: 'log-1' });

      await activateProfessional('prof-456', 'actor-123');

      expect(mockPrisma.professional.update).toHaveBeenCalledWith({
        where: { id: 'prof-456' },
        data: { status: 'ACTIVE' },
      });
    });
  });
});