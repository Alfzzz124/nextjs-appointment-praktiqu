/**
 * Zod validation schemas for Client (Feature 004).
 *
 * Rules (data-model.md §Validation Rules):
 *  - fullName: required, max 100 chars
 *  - email: required, valid email, max 255 chars
 *  - mobileNumber: required, min 8 digits, optional leading '+'
 *  - dateOfBirth: required, ISO date, not in the future
 *  - gender: required, one of MALE | FEMALE | OTHER
 *  - address: optional, max 500 chars
 *  - emergencyContact: optional, max 100 chars
 *  - notes: optional, max 1000 chars
 *
 * RFC 7807 field-level errors are produced by the API route via the
 * `formatFieldErrors` helper at the bottom of this file.
 */

import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/** Mobile: optional leading '+', then 8–20 digits. */
export const mobileNumberSchema = z
  .string()
  .trim()
  .min(1, 'Mobile number is required')
  .regex(
    /^\+?\d{8,20}$/,
    'Mobile number must be 8–20 digits (optional leading +)',
  );

/** Date of birth: ISO date string (YYYY-MM-DD), not in the future. */
export const dateOfBirthSchema = z
  .string()
  .min(1, 'Date of birth is required')
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: 'Invalid date format',
  })
  .refine((s) => {
    const d = new Date(s);
    const now = new Date();
    // Allow same-day (DOB == today) by comparing day-truncated dates
    const dobDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return dobDay <= today;
  }, 'Date of birth cannot be in the future');

export const genderSchema = z.enum(['MALE', 'FEMALE', 'OTHER'], {
  errorMap: () => ({ message: 'Gender must be MALE, FEMALE, or OTHER' }),
});

export const clientStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']);

/* ------------------------------------------------------------------ */
/* Create / update                                                     */
/* ------------------------------------------------------------------ */

/** POST /clients — staff registration. */
export const createClientSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, 'Full name is required')
    .max(100, 'Full name must be at most 100 characters'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Email is required')
    .email('Invalid email address')
    .max(255, 'Email must be at most 255 characters'),
  mobileNumber: mobileNumberSchema,
  dateOfBirth: dateOfBirthSchema,
  gender: genderSchema,
  address: z
    .string()
    .trim()
    .max(500, 'Address must be at most 500 characters')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  emergencyContact: z
    .string()
    .trim()
    .max(100, 'Emergency contact must be at most 100 characters')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  notes: z
    .string()
    .trim()
    .max(1000, 'Notes must be at most 1000 characters')
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;

/**
 * PATCH /clients/[id] — partial update.
 *
 * All fields optional; at least one must be provided. Role-based filtering
 * is applied by the service layer (CLIENT may only submit editable fields).
 */
export const updateClientSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(1)
      .max(100, 'Full name must be at most 100 characters')
      .optional(),
    email: z.string().trim().toLowerCase().email().max(255).optional(),
    mobileNumber: mobileNumberSchema.optional(),
    dateOfBirth: dateOfBirthSchema.optional(),
    gender: genderSchema.optional(),
    address: z.string().trim().max(500).optional().or(z.literal('').transform(() => null)),
    emergencyContact: z.string().trim().max(100).optional().or(z.literal('').transform(() => null)),
    notes: z.string().trim().max(1000).optional().or(z.literal('').transform(() => null)),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateClientInput = z.infer<typeof updateClientSchema>;

/** PATCH /clients/[id]/status. */
export const updateStatusSchema = z.object({
  status: clientStatusSchema,
});
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

/** GET /clients query params. */
export const listClientsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(100).optional(),
  status: clientStatusSchema.optional(),
});
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** RFC 7807 field-level error shape (contracts/api.md). */
export interface FieldError {
  field: string;
  message: string;
}

export function formatFieldErrors(err: z.ZodError): FieldError[] {
  return err.issues.map((i) => ({
    field: i.path.join('.') || '(root)',
    message: i.message,
  }));
}
