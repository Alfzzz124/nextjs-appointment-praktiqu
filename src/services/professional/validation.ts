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

/**
 * One stretch of a day the professional works.
 *
 * The shape mirrors what `GET` returns and what `setWeeklySchedule` consumes: a KiviCare
 * day slug and wall-clock times, not a numeric weekday and minute offsets. The two used
 * to disagree — the route validated `{dayOfWeek, startMinute, endMinute}` and then handed
 * it to a service reading `{day, startTime, endTime}`, so every request 422'd whichever
 * shape it sent.
 */
const AVAILABILITY_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const availabilityWindowSchema = z.object({
  day: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  startTime: z.string().regex(AVAILABILITY_TIME_RE, 'startTime must be HH:MM or HH:MM:SS'),
  endTime: z.string().regex(AVAILABILITY_TIME_RE, 'endTime must be HH:MM or HH:MM:SS'),
  slotDurationMinutes: z.coerce.number().int().min(1).max(240).default(30),
})
  // The `TIME` column and the service both speak HH:MM:SS; a form sends HH:MM.
  .transform((w) => ({ ...w, startTime: withSeconds(w.startTime), endTime: withSeconds(w.endTime) }))
  .refine(
    (data) => toMinutesOfDay(data.endTime) > toMinutesOfDay(data.startTime),
    { message: 'endTime must be after startTime' },
  );

function withSeconds(t: string): string { return t.length === 5 ? `${t}:00` : t; }

function toMinutesOfDay(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

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
  // No userId: the WordPress user IS the professional, and the plugin creates it.
  // clinicId is a numeric wp_kc_clinics id, not a cuid (decision D2).
  clinicId: z.coerce.number().int().positive().optional(),
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
  clinicId: z.coerce.number().int().positive().optional(),
  biography: z.string().max(2000).nullable().optional(),
  specialties: z.array(z.string().max(100)).max(20).nullable().optional(),
  contactInfo: contactInfoSchema.nullable().optional(),
});

// ============================================
// Self-Update (US2 — Professional edits own profile)
// ============================================
// Only biography, specialties, contactInfo can be updated.
// SIP/SIK and professionalType are read-only.

export const selfUpdateProfessionalInputSchema = z
  .object({
    biography: z.string().max(2000).nullable().optional(),
    specialties: z.array(z.string().max(100)).max(20).nullable().optional(),
    contactInfo: contactInfoSchema.nullable().optional(),
  })
  // Reject read-only fields (registrationNumber/SIP-SIK, professionalType, …)
  // rather than silently stripping them.
  .strict();

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
  clinicId: z.coerce.number().int().positive().optional(),
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
import { findDoctorByRegistrationNumber } from '@/repositories/wp/doctors.repo';

/**
 * Check that registrationNumber (SIP/SIK) is unique.
 *
 * Reads `wp_usermeta`, which has no unique index on (meta_key, meta_value) — so this is
 * check-then-write and inherently racy. The plugin re-checks immediately before the
 * insert, which is where the authoritative check lives; this one exists to give the
 * caller a field-level error instead of a bare 409.
 */
export async function checkUniqueRegistrationNumber(
  registrationNumber: string,
  excludeWpUserId?: number,
): Promise<void> {
  const existing = await findDoctorByRegistrationNumber(registrationNumber);
  if (existing && Number(existing.id) !== excludeWpUserId) {
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
 * Check that the email is unused.
 *
 * Scoped to WordPress users generally, not just doctors: `wp_users.user_email` is
 * unique across every role, so a patient already holding the address would block the
 * insert just the same.
 */
export async function checkUniqueEmail(
  email: string,
  excludeWpUserId?: number,
): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ ID: bigint | number }>>(
    `SELECT ID FROM wp_users WHERE user_email = ? LIMIT 1`,
    email,
  );
  const owner = rows[0] ? Number(rows[0].ID) : null;
  if (owner !== null && owner !== excludeWpUserId) {
    throw new z.ZodError([
      {
        code: 'custom',
        message: `Email "${email}" is already registered`,
        path: ['email'],
      },
    ]);
  }
}
