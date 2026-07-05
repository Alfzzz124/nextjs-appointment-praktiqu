/**
 * Zod validation for the Session Notes feature.
 *
 * All API inputs go through these schemas before reaching the service.
 * SOAP fields are plain text but constrained to a sensible maximum to
 * keep the database column sizes bounded.
 */

import { z } from 'zod';

export const noteStatusSchema = z.enum(['OPEN', 'CLOSED']);

export const sessionNoteSoapSchema = z.object({
  subjective: z.string().max(10_000, 'Subjective section too long').default(''),
  objective: z.string().max(10_000, 'Objective section too long').default(''),
  assessment: z.string().max(10_000, 'Assessment section too long').default(''),
  plan: z.string().max(10_000, 'Plan section too long').default(''),
});

export const createSessionNoteSchema = z
  .object({
    sessionId: z.string().min(1, 'sessionId is required'),
    content: z
      .string()
      .min(1, 'Notes content cannot be empty')
      .max(50_000, 'Notes content too long')
      .optional(),
    soap: sessionNoteSoapSchema.optional(),
  })
  .refine((d) => d.content !== undefined || d.soap !== undefined, {
    message: 'Either content or soap is required',
    path: ['content'],
  });

export const updateSessionNoteSchema = z
  .object({
    content: z
      .string()
      .min(1, 'Notes content cannot be empty')
      .max(50_000, 'Notes content too long')
      .optional(),
    soap: sessionNoteSoapSchema.optional(),
  })
  .refine((d) => d.content !== undefined || d.soap !== undefined, {
    message: 'Either content or soap is required',
    path: ['content'],
  });

export const listSessionNotesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  clientId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  status: noteStatusSchema.optional(),
});

export type CreateSessionNoteInput = z.infer<typeof createSessionNoteSchema>;
export type UpdateSessionNoteInput = z.infer<typeof updateSessionNoteSchema>;
export type ListSessionNotesQuery = z.infer<typeof listSessionNotesQuerySchema>;
export type SessionNoteSoapInput = z.infer<typeof sessionNoteSoapSchema>;

/**
 * Format SOAP sections into a single, readable content string.
 * Empty sections are omitted entirely; an all-empty SOAP yields ''.
 */
export function formatSoapToContent(soap: SessionNoteSoapInput): string {
  const sections: Array<[string, string]> = [
    ['SUBJECTIVE', soap.subjective],
    ['OBJECTIVE', soap.objective],
    ['ASSESSMENT', soap.assessment],
    ['PLAN', soap.plan],
  ];
  return sections
    .filter(([, body]) => body.trim() !== '')
    .map(([header, body]) => `${header}:\n${body.trim()}`)
    .join('\n\n');
}

/** Build the truncated 200-char summary used by feature 014. */
export function buildSummary(content: string, max = 200): string {
  const trimmed = content.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}
