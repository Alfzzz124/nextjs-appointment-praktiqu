/**
 * Zod validation schemas for Professional Management API.
 *
 * T006, T023, T024, T025 — validation for all professional endpoints.
 * RFC 7807 field-level errors: `fields` map with array of error strings per field.
 */

import { z } from 'zod';

// ============================================
// Common / Shared Schemas
// ============================================

/** SIP/SIK format: 3 letters + dash + 5 digits + dash + 4 digits.
 * Example: PSI-12345-2024
 */
const REGISTRATION_NUMBER_REGEX = /^[A-Z]{2,3}-\d{5}-\d{4}$/;

export const registrationNumberSchema = z.string().regex(
  REGISTRATION_NUMBER_REGEX,
  'Registration number must match format: AAA-NNNNN-YYYY (e.g., PSI-12345-2024)',
);

/** Indonesian phone number format */
const PHONE_REGEX = /^(\+62|62|0)[0-9]{8,13}$/;

export const phoneSchema = z.string().regex(
  PHONE_REGEX,
  'Phone must be a valid Indonesian phone number (e.g., 08123456789 or +628123456789)',
);

// ============================================
// Contact Info
// ============================================

export const contactInfoSchema = z.object({
  phone: phoneSchema.optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
}).passthrough(); // allow extra fields

// ============================================
// ProfessionalType enum values
// ============================================

export const professionalTypeEnum = z.enum([
  'PSIKOLOG_KLINIS',
  'PSIKOLOG_ANAK',
  'PSIKIATER',
  'KONSELOR',
]);

// ============================================
// ProfessionalStatus enum values
// ============================================

export const professionalStatusEnum = z.enum([
  'PENDING_ACTIVATION',
  'ACTIVE',
  'INACTIVE',
]);

// ============================================
// Availability Window
// ============================================

export const availabilityWindowSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
}).refine(
  (data) => data.endMinute > data.startMinute,
  { message: 'endMinute must be greater than startMinute' },
);

export const setAvailabilityInputSchema = z.object({
  schedule: z.array(availabilityWindowSchema).min(1, 'At least one availability window is required'),
});

// ============================================
// Off Day
// ============================================

const DATE_STRING_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const createOffDayInputSchema = z.object({
  startDate: z.string().regex(DATE_STRING_REGEX, 'startDate must be YYYY-MM-DD'),
  endDate: z.string().regex(DATE_STRING_REGEX, 'endDate must be YYYY-MM-DD'),
  reason: z.string().max(255).optional(),
}).refine(
  (data) => {
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    return end >= start;
  },
  { message: 'endDate must be greater than or equal to startDate' },
);

// ============================================
// Create Professional (US1)
// ============================================

export const createProfessionalInputSchema = z.object({
  userId: z.string().cuid('Invalid userId format'),
  practiceId: z.string().cuid('Invalid practiceId format').optional().nullable(),
  fullName: z.string().min(2, 'Full name must be at least 2 characters').max(200),
  email: z.string().email('Invalid email address'),
  professionalType: professionalTypeEnum,
  registrationNumber: registrationNumberSchema,
  biography: z.string().max(2000).optional(),
  specialties: z.array(z.string().max(100)).max(20).optional(),
  contactInfo: contactInfoSchema.optional(),
});

// ============================================
// Update Professional (Full — Super Admin / Clinic Admin)
// ============================================

export const updateProfessionalInputSchema = z.object({
  fullName: z.string().min(2).max(200).optional(),
  practiceId: z.string().cuid().nullable().optional(),
  biography: z.string().max(2000).nullable().optional(),
  specialties: z.array(z.string().max(100)).max(20).nullable().optional(),
  contactInfo: contactInfoSchema.nullable().optional(),
});

// ============================================
// Self-Update (US2 — Professional edits own profile)
// ============================================
// Only biography, specialties, contactInfo can be updated.
// SIP/SIK and professionalType are read-only.

export const selfUpdateProfessionalInputSchema = z.object({
  biography: z.string().max(2000).nullable().optional(),
  specialties: z.array(z.string().max(100)).max(20).nullable().optional(),
  contactInfo: contactInfoSchema.nullable().optional(),
});

// ============================================
// Status Change
// ============================================

export const statusChangeInputSchema = z.object({
  status: professionalStatusEnum,
});

// ============================================
// Service Assignment
// ============================================

export const assignServiceInputSchema = z.object({
  serviceId: z.string().cuid('Invalid serviceId format'),
});

// ============================================
// Slot Query
// ============================================

export const slotQuerySchema = z.object({
  date: z.string().regex(DATE_STRING_REGEX, 'date must be YYYY-MM-DD'),
  serviceId: z.string().cuid('Invalid serviceId format'),
});

// ============================================
// List / Search Query Params
// ============================================

export const professionalListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
  status: professionalStatusEnum.optional(),
  practiceId: z.string().cuid().optional(),
  sortBy: z.enum(['fullName', 'email', 'createdAt', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ============================================
// Field-level error builder (T025)
// ============================================

export interface FieldErrors {
  [field: string]: string[];
}

/**
 * Build a RFC 7807 problem response with field-level errors.
 * Used when Zod validation fails on a request body.
 */
export function buildFieldErrors(
  issues: z.ZodIssue[],
): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const path = issue.path.join('.') || 'root';
    if (!errors[path]) errors[path] = [];
    errors[path].push(issue.message);
  }
  return errors;
}

// ============================================
// Unique validation helpers (T023, T024)
// ============================================

import { prisma } from '@/lib/db';

/**
 * Check that registrationNumber (SIP/SIK) is unique.
 * Throws Zod error if a professional with this number already exists.
 */
export async function checkUniqueRegistrationNumber(
  registrationNumber: string,
  excludeId?: string,
): Promise<void> {
  const existing = await prisma.professional.findFirst({
    where: {
      registrationNumber,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (existing) {
    throw new z.ZodError([
      {
        code: 'custom',
        message: `Registration number "${registrationNumber}" is already in use`,
        path: ['registrationNumber'],
      },
    ]);
  }
}

/**
 * Check that email is unique.
 * Throws Zod error if a professional with this email already exists.
 */
export async function checkUniqueEmail(
  email: string,
  excludeId?: string,
): Promise<void> {
  const existing = await prisma.professional.findFirst({
    where: {
      email,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (existing) {
    throw new z.ZodError([
      {
        code: 'custom',
        message: `Email "${email}" is already registered to another professional`,
        path: ['email'],
      },
    ]);
  }
}