/**
 * Zod validation for session notes.
 *
 * A session note IS a KiviCare encounter (phase E3). SOAP is gone: it was our own
 * imposition, invisible to every KiviCare screen. Its replacement is KiviCare's own
 * vocabulary — repeatable `entries` typed `problem` / `observation` / `note` — which
 * its encounter view, templates and print/PDF output already render.
 */

import { z } from 'zod';
import { HISTORY_TYPE } from '@/repositories/wp/encounters.write';

export const noteStatusSchema = z.enum(['OPEN', 'CLOSED']);

/** KiviCare's `wp_kc_medical_history.type` vocabulary. */
export const historyTypeSchema = z.enum([
  HISTORY_TYPE.PROBLEM,
  HISTORY_TYPE.OBSERVATION,
  HISTORY_TYPE.NOTE,
]);

/**
 * One line of the clinical record.
 *
 * `title` is KiviCare's column name for the text — it is a `TEXT` column, not a short
 * heading, so the limit is generous.
 */
export const sessionNoteEntrySchema = z.object({
  type: historyTypeSchema,
  title: z.string().min(1, 'Entry text cannot be empty').max(10_000, 'Entry too long'),
});

/**
 * A KiviCare appointment id, carried as text.
 *
 * Digits are required so a stray identifier — a cuid left over from the shadow tables —
 * cannot become NaN on the way to SQL.
 */
const numericId = (field: string) =>
  z.string().regex(/^\d+$/, `${field} must be a numeric id`);

export const createSessionNoteSchema = z
  .object({
    sessionId: numericId('sessionId'),
    /** Free-text summary; becomes the encounter's own `description`. */
    content: z.string().max(50_000, 'Notes content too long').optional(),
    entries: z.array(sessionNoteEntrySchema).max(100, 'Too many entries').optional(),
  })
  .refine(
    (d) => (d.content !== undefined && d.content !== '') || (d.entries?.length ?? 0) > 0,
    {
      message: 'Either content or at least one entry is required',
      path: ['content'],
    },
  );

export const updateSessionNoteSchema = z
  .object({
    content: z.string().max(50_000, 'Notes content too long').optional(),
    entries: z.array(sessionNoteEntrySchema).max(100, 'Too many entries').optional(),
  })
  .refine((d) => d.content !== undefined || d.entries !== undefined, {
    message: 'Either content or entries is required',
    path: ['content'],
  });

export const listSessionNotesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  clientId: numericId('clientId').optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  status: noteStatusSchema.optional(),
});

export type SessionNoteEntry = z.infer<typeof sessionNoteEntrySchema>;
export type CreateSessionNoteInput = z.infer<typeof createSessionNoteSchema>;
export type UpdateSessionNoteInput = z.infer<typeof updateSessionNoteSchema>;
export type ListSessionNotesQuery = z.infer<typeof listSessionNotesQuerySchema>;

/**
 * Flatten the encounter's description and entries into one searchable body.
 *
 * Used for the summary and for `?search=`, which has no column to match on now that
 * the text lives across `description` plus N `medical_history` rows.
 */
export function entriesToContent(
  description: string | null,
  entries: ReadonlyArray<{ type: string; title: string }>,
): string {
  const parts: string[] = [];
  if (description && description.trim() !== '') parts.push(description.trim());
  for (const e of entries) {
    parts.push(`${e.type.toUpperCase()}: ${e.title}`);
  }
  return parts.join('\n');
}

/**
 * First `max` characters of the content, whitespace collapsed, ellipsised.
 *
 * Derived on read now — there is no `summary` column on an encounter, and storing one
 * would be a second copy of text that can drift from its source.
 */
export function buildSummary(content: string, max = 200): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}
