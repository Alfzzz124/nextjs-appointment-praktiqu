/**
 * Integration tests for professional creation.
 * T029: covers happy path and validation errors (US1)
 */

import { describe, it, expect } from 'vitest';
import { createProfessionalInputSchema } from '@/services/professional/validation';
import type { ProfessionalType } from '@prisma/client';

describe('Create Professional Integration', () => {
  describe('Happy path', () => {
    it('should accept valid professional creation payload', () => {
      const validPayload = {
        userId: 'clxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        fullName: 'Dr. Jane Doe',
        email: 'jane.doe@example.com',
        professionalType: 'PSIKOLOG_KLINIS' as ProfessionalType,
        registrationNumber: 'PSI-12345-2024',
        biography: 'Clinical psychologist with 10 years experience',
        specialties: ['Depresi', 'Kecemasan'],
        contactInfo: { phone: '+6281234567890' },
      };

      const result = createProfessionalInputSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it('should accept payload without optional fields', () => {
      const minimalPayload = {
        userId: 'clxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        fullName: 'Dr. Jane Doe',
        email: 'jane.doe@example.com',
        professionalType: 'PSIKIATER' as ProfessionalType,
        registrationNumber: 'PSI-99999-2024',
      };

      const result = createProfessionalInputSchema.safeParse(minimalPayload);
      expect(result.success).toBe(true);
    });
  });

  describe('Validation errors (T025)', () => {
    it('should reject invalid email', () => {
      const invalidPayload = {
        userId: 'clxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        fullName: 'Dr. Jane Doe',
        email: 'not-an-email',
        professionalType: 'PSIKOLOG_KLINIS' as ProfessionalType,
        registrationNumber: 'PSI-12345-2024',
      };

      const result = createProfessionalInputSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      const issues = result.error.issues;
      const emailIssue = issues.find((i) => i.path.includes('email'));
      expect(emailIssue).toBeDefined();
    });

    it('should reject invalid registration number format', () => {
      const invalidPayload = {
        userId: 'clxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        fullName: 'Dr. Jane Doe',
        email: 'jane@example.com',
        professionalType: 'PSIKOLOG_KLINIS' as ProfessionalType,
        registrationNumber: 'INVALID-FORMAT', // wrong format
      };

      const result = createProfessionalInputSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      const issues = result.error.issues;
      const regIssue = issues.find((i) => i.path.includes('registrationNumber'));
      expect(regIssue).toBeDefined();
    });

    it('should reject invalid professional type', () => {
      const invalidPayload = {
        userId: 'clxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        fullName: 'Dr. Jane Doe',
        email: 'jane@example.com',
        professionalType: 'INVALID_TYPE' as ProfessionalType,
        registrationNumber: 'PSI-12345-2024',
      };

      const result = createProfessionalInputSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
      const incompletePayload = {
        userId: 'clxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        // missing fullName, email, professionalType, registrationNumber
      };

      const result = createProfessionalInputSchema.safeParse(incompletePayload);
      expect(result.success).toBe(false);
      expect(result.error.issues.length).toBeGreaterThanOrEqual(4);
    });

    it('should reject fullName too short', () => {
      const invalidPayload = {
        userId: 'clxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        fullName: 'J', // too short
        email: 'jane@example.com',
        professionalType: 'PSIKOLOG_KLINIS' as ProfessionalType,
        registrationNumber: 'PSI-12345-2024',
      };

      const result = createProfessionalInputSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      const nameIssue = result.error.issues.find((i) => i.path.includes('fullName'));
      expect(nameIssue?.message).toContain('at least 2 characters');
    });

    it('should reject too many specialties', () => {
      const invalidPayload = {
        userId: 'clxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        fullName: 'Dr. Jane Doe',
        email: 'jane@example.com',
        professionalType: 'PSIKOLOG_KLINIS' as ProfessionalType,
        registrationNumber: 'PSI-12345-2024',
        specialties: Array.from({ length: 25 }, (_, i) => `Specialty ${i}`),
      };

      const result = createProfessionalInputSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      const specialtyIssue = result.error.issues.find((i) => i.path.includes('specialties'));
      expect(specialtyIssue).toBeDefined();
    });

    it('should reject invalid phone number format', () => {
      const invalidPayload = {
        userId: 'clxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        fullName: 'Dr. Jane Doe',
        email: 'jane@example.com',
        professionalType: 'PSIKOLOG_KLINIS' as ProfessionalType,
        registrationNumber: 'PSI-12345-2024',
        contactInfo: { phone: 'invalid-phone' },
      };

      const result = createProfessionalInputSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });
  });

  describe('All professional types accepted', () => {
    const types: ProfessionalType[] = [
      'PSIKOLOG_KLINIS',
      'PSIKOLOG_ANAK',
      'PSIKIATER',
      'KONSELOR',
    ];

    for (const type of types) {
      it(`should accept ${type}`, () => {
        const payload = {
          userId: 'clxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
          fullName: 'Dr. Test',
          email: `test.${type.toLowerCase()}@example.com`,
          professionalType: type,
          registrationNumber: `TST-${Math.random().toString(36).substring(2, 7).toUpperCase()}-2024`,
        };
        const result = createProfessionalInputSchema.safeParse(payload);
        expect(result.success).toBe(true);
      });
    }
  });
});