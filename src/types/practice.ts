/**
 * Practice types and Zod validation schemas.
 *
 * A "Practice" maps to the KiviCare `Clinic` table — see prisma/schema.prisma.
 * The Practice is the business entity that owns settings, schedules, and
 * holidays. Patients/Professionals map to a Practice via join tables.
 *
 * Source of truth: docs/architecture/ARCHITECTURE.md, spec 013-practice-mgmt.
 */

import { z } from 'zod';

// ============================================================
// Enums (mirror Prisma Int columns for KiviCare compatibility)
// ============================================================

export const PracticeStatus = {
  INACTIVE: 0,
  ACTIVE: 1,
} as const;

export type PracticeStatusValue = (typeof PracticeStatus)[keyof typeof PracticeStatus];

// ============================================================
// Business hours
// ============================================================

/**
 * Business hours for a single day. Open = false means closed all day.
 * Times are in `HH:mm` 24h format. The `dayOfWeek` follows JS Date
 * convention: 0 = Sunday ... 6 = Saturday.
 */
export const businessHoursSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  open: z.boolean().default(true),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'startTime must be HH:mm')
    .nullable()
    .default(null),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'endTime must be HH:mm')
    .nullable()
    .default(null),
});
export type BusinessHours = z.infer<typeof businessHoursSchema>;

// ============================================================
// Holiday
// ============================================================

export const holidayInputSchema = z.object({
  title: z.string().min(1).max(120),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD'),
  isAllDay: z.boolean().default(true),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'startTime must be HH:mm')
    .nullable()
    .optional(),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'endTime must be HH:mm')
    .nullable()
    .optional(),
});
export type HolidayInput = z.infer<typeof holidayInputSchema>;

// ============================================================
// Practice settings
// ============================================================

/**
 * Partial-update schema for the Practice. All fields are optional to
 * support PATCH semantics. Logo URL must be http(s); currency must be a
 * 3-letter ISO 4217 code.
 */
export const practiceUpdateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    email: z.string().email().nullable().optional(),
    telephoneNo: z.string().min(3).max(40).nullable().optional(),
    address: z.string().max(255).nullable().optional(),
    city: z.string().max(80).nullable().optional(),
    state: z.string().max(80).nullable().optional(),
    country: z.string().max(80).nullable().optional(),
    postalCode: z.string().max(20).nullable().optional(),
    countryCode: z
      .string()
      .length(2, 'countryCode must be ISO 3166-1 alpha-2')
      .nullable()
      .optional(),
    countryCallingCode: z
      .string()
      .regex(/^\+\d{1,4}$/, 'countryCallingCode must be E.164 like "+1"')
      .nullable()
      .optional(),
    timezone: z
      .string()
      .min(1)
      .refine((tz) => {
        try {
          // Throws on invalid IANA timezone names
          Intl.DateTimeFormat(undefined, { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'timezone must be a valid IANA timezone')
      .optional(),
    logoUrl: z
      .string()
      .url()
      .refine((u) => /^https?:\/\//.test(u), 'logoUrl must be http(s)')
      .nullable()
      .optional(),
    status: z
      .union([z.literal(PracticeStatus.ACTIVE), z.literal(PracticeStatus.INACTIVE)])
      .optional(),
    businessHours: z.array(businessHoursSchema).max(7).optional(),
  })
  .strict();
export type PracticeUpdateInput = z.infer<typeof practiceUpdateSchema>;

// ============================================================
// Practice creation
// ============================================================

/** Who becomes the new clinic's admin (wp_kc_clinics.clinic_admin_id). */
export const clinicAdminChoiceSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('existing'), wpUserId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
  z.object({ mode: z.literal('new'), name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(100) }).strict(),
  z.object({ mode: z.literal('none') }).strict(),
]);
export type ClinicAdminChoice = z.infer<typeof clinicAdminChoiceSchema>;

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

/**
 * POST /practices. The contact fields follow practiceUpdateSchema, but `name` is required
 * and the extra-blob fields (timezone, logoUrl, businessHours) are not accepted here — set
 * them afterwards with PATCH.
 */
export const practiceCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(191).nullable().optional(),
    telephoneNo: z.string().trim().min(3).max(40).nullable().optional(),
    address: optionalText(255),
    city: optionalText(80),
    state: optionalText(80),
    country: optionalText(80),
    postalCode: optionalText(20),
    countryCode: z.string().length(2, 'countryCode must be ISO 3166-1 alpha-2').nullable().optional(),
    countryCallingCode: z
      .string()
      .regex(/^\+\d{1,4}$/, 'countryCallingCode must be E.164 like "+1"')
      .nullable()
      .optional(),
    status: z
      .union([z.literal(PracticeStatus.ACTIVE), z.literal(PracticeStatus.INACTIVE)])
      .default(PracticeStatus.ACTIVE),
    admin: clinicAdminChoiceSchema.default({ mode: 'none' }),
  })
  .strict();
export type PracticeCreateInput = z.infer<typeof practiceCreateSchema>;

// ============================================================
// Response shapes
// ============================================================

/** Wire shape returned by the practice service to API routes. */
export interface PracticeDTO {
  /** `wp_kc_clinics.id` — numeric since practices moved to KiviCare's table (D2). */
  id: number;
  name: string;
  email: string | null;
  telephoneNo: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  countryCode: string | null;
  countryCallingCode: string | null;
  timezone: string | null;
  logoUrl: string | null;
  status: PracticeStatusValue;
  businessHours: BusinessHours[];
  /**
   * The clinic's stored International flag (read only; edited through
   * `/practices/{id}/payment-settings`). It drives the admin badge and is false when the
   * settings cannot be read. Clients decide the USD display and the payment methods from
   * the public `usd` / `paymentMethods` fields, never from this.
   */
  international: boolean;
  createdAt: string;
  /**
   * KiviCare's clinics table has no `updated_at`, so this mirrors `createdAt` rather
   * than reporting a time nothing recorded.
   */
  updatedAt: string;
}

export interface HolidayDTO {
  /** `wp_kc_clinic_schedule.id`. */
  id: number;
  practiceId: number;
  title: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  isAllDay: boolean;
  startTime: string | null; // HH:mm
  endTime: string | null; // HH:mm
}
