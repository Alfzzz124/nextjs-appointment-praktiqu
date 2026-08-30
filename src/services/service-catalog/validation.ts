/**
 * Request shapes for `/api/v1/services`.
 *
 * The bounds are KiviCare's, read off `DoctorServiceController::validateDuration` and
 * `::validateStatus` — 1..1440 minutes, status 0 or 1 — not invented here.
 */
import { z } from 'zod';

const flag = z.union([z.literal(0), z.literal(1)]);

const nameSchema = z.string().trim().min(1, 'Service name is required').max(255);
const durationSchema = z
  .number()
  .int('Duration must be a whole number of minutes')
  .min(1, 'Duration must be between 1 and 1440 minutes')
  .max(1440, 'Duration must be between 1 and 1440 minutes');
const priceSchema = z.number().min(0, 'Price cannot be negative');
const idSchema = z.number().int().positive();

/**
 * `.strip()` is the default, and it is load-bearing here: `maxClients` has no column
 * anywhere, and silently accepting it would be the exact pattern this dashboard has
 * already had cleaned out twice. Unknown keys are dropped, never stored.
 */
export const createServiceSchema = z.object({
  name: nameSchema,
  categoryId: idSchema,
  price: priceSchema,
  duration: durationSchema,
  doctorIds: z.array(idSchema).min(1, 'At least one professional is required'),
  /** Ignored for CLINIC_ADMIN, who is pinned to their own clinic. */
  clinicId: idSchema.optional(),
  telemedService: z.enum(['yes', 'no']).default('no'),
  status: flag.default(1),
  isPublic: flag.default(1),
});

/**
 * `doctorIds` and `clinicId` are absent on purpose. Moving a service to another
 * psychologist means deleting this mapping and creating another; that keeps PUT to one
 * row and one meaning.
 */
export const updateServiceSchema = z
  .object({
    name: nameSchema.optional(),
    categoryId: idSchema.optional(),
    price: priceSchema.optional(),
    duration: durationSchema.optional(),
    telemedService: z.enum(['yes', 'no']).optional(),
    status: flag.optional(),
    isPublic: flag.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

/**
 * `includeInactive` is parsed as a literal string rather than with `z.coerce.boolean()`,
 * which turns the string `'false'` into `true` — every non-empty string is truthy.
 */
export const listServicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
  clinicId: z.coerce.number().int().positive().optional(),
  professionalId: z.coerce.number().int().positive().optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
export type ListServicesQuery = z.infer<typeof listServicesQuerySchema>;

/** RFC 7807 `fields`: one array of messages per offending path. */
export function toFieldErrors(err: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Response shapes — consumed by scripts/generate-openapi.ts           */
/* ------------------------------------------------------------------ */

export const serviceCategorySchema = z.object({
  id: z.number().int(),
  label: z.string().nullable(),
  value: z.string().nullable(),
});

export const serviceSummarySchema = z.object({
  id: z.number().int().describe('The doctor-service mapping id'),
  serviceId: z.number().int().describe('The catalogue row id'),
  doctorId: z.number().int(),
  clinicId: z.number().int(),
  name: z.string(),
  category: serviceCategorySchema.nullable(),
  price: z.number().nullable().describe('The charge that applies, from the mapping'),
  durationMinutes: z.number().int().nullable(),
  telemedService: z.enum(['yes', 'no']),
  isPublic: z.boolean(),
  isActive: z.boolean(),
});

export const serviceListResponseSchema = z.object({
  services: z.array(serviceSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  perPage: z.number().int(),
});

export const createdServiceSchema = z.object({
  serviceId: z.number().int(),
  name: z.string(),
  category: serviceCategorySchema,
  mappings: z.array(z.object({ id: z.number().int(), doctorId: z.number().int() })),
});

export const serviceCategoryListSchema = z.object({
  categories: z.array(serviceCategorySchema),
});

export const deleteServiceResponseSchema = z.object({ ok: z.literal(true) });
