/**
 * Zod validation schemas for session management.
 *
 * Source of truth: specs/005-session-mgmt/data-model.md and contracts/api.md
 */

import { z } from 'zod';
import { SessionStatus } from '@prisma/client';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'slotDate must be YYYY-MM-DD');

const isoDateTime = z
  .string()
  .datetime({ offset: true, message: 'startTime must be an ISO 8601 datetime' });

const cuid = z.string().min(1, 'id is required');

const rejectionReason = z
  .string()
  .trim()
  .min(1, 'Reason is required')
  .max(500, 'Reason must not exceed 500 characters');

const optionalReason = z
  .string()
  .trim()
  .max(500, 'Reason must not exceed 500 characters')
  .optional()
  .or(z.literal(''));

/** POST /api/v1/sessions — body for creating a session. */
export const createSessionSchema = z
  .object({
    clientId: cuid,
    professionalId: cuid,
    serviceId: cuid,
    slotDate: isoDate,
    startTime: isoDateTime,
    /** Optional override; only set by staff routes. */
    createdBy: z.string().optional(),
  })
  .strict();
export type CreateSessionBody = z.infer<typeof createSessionSchema>;

/** POST /api/v1/sessions/:id/reject — body. */
export const rejectSessionSchema = z
  .object({
    reason: rejectionReason,
  })
  .strict();
export type RejectSessionBody = z.infer<typeof rejectSessionSchema>;

/** POST /api/v1/sessions/:id/cancel — body (reason optional). */
export const cancelSessionSchema = z
  .object({
    reason: optionalReason,
  })
  .strict();
export type CancelSessionBody = z.infer<typeof cancelSessionSchema>;

/** GET /api/v1/sessions — query filters. */
export const listSessionsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.nativeEnum(SessionStatus).optional(),
    clientId: z.string().optional(),
    professionalId: z.string().optional(),
    serviceId: z.string().optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
  })
  .strict();
export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;

/** GET /api/v1/sessions/calendar — query. */
export const calendarQuerySchema = z
  .object({
    view: z.enum(['day', 'week', 'month']).default('day'),
    date: isoDate.optional(),
    professionalId: z.string().optional(),
  })
  .strict();
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

/** PATCH /api/v1/sessions/:id/status — generic status update. */
export const statusUpdateSchema = z
  .object({
    status: z.nativeEnum(SessionStatus),
    reason: optionalReason,
  })
  .strict();
export type StatusUpdateBody = z.infer<typeof statusUpdateSchema>;

/** Helper: validate that `dateTo >= dateFrom` when both present. */
export function assertDateRange(query: {
  dateFrom?: string;
  dateTo?: string;
}): void {
  if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
    throw new Error('dateFrom must be on or before dateTo');
  }
}
