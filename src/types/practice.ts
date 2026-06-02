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
// Response shapes
// ============================================================

/** Wire shape returned by the practice service to API routes. */
export interface PracticeDTO {
  id: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface HolidayDTO {
  id: string;
  practiceId: string;
  title: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  isAllDay: boolean;
  startTime: string | null; // HH:mm
  endTime: string | null; // HH:mm
}
