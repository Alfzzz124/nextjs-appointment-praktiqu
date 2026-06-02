/**
 * Email-template domain types.
 *
 * Source of truth: specs/018-email-templates/spec.md
 * Storage: prisma EmailTemplate model
 *
 * A template has:
 *   - a unique `key` (e.g. "appointment-confirmation")
 *   - a subject line
 *   - body in HTML and plain text
 *   - configurable `fromName` and `replyTo`
 *   - declared variables (placeholders) for the renderer
 *
 * The actual placeholders in the body use `{{varName}}` syntax. The render
 * engine replaces them with the values from the supplied VariableContext.
 */

import { z } from 'zod';

/** Variable name convention: lowercase snake_case, alphanumeric + underscore. */
export const TEMPLATE_VAR_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** Match `{{ varName }}` (whitespace tolerant). Captures the inner name. */
export const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

/** Public shape of an email template returned to callers. */
export interface EmailTemplateDTO {
  id: string;
  key: string;
  name: string;
  description: string | null;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  fromName: string | null;
  replyTo: string | null;
  variables: string[];
  status: 'active' | 'inactive';
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

/** Variable values supplied to the renderer at send time. */
export type VariableContext = Record<string, string | number | boolean | null | undefined>;

/** Result of rendering a template. */
export interface RenderedTemplate {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  fromName: string | null;
  replyTo: string | null;
  /** Variables that appeared in the template but were not supplied. */
  missingVariables: string[];
}

// ============================================================
// Zod schemas (input validation for routes + tests)
// ============================================================

export const variableNameSchema = z
  .string()
  .regex(TEMPLATE_VAR_NAME, 'Variable names must be lowercase snake_case (a-z, 0-9, _)');

export const createEmailTemplateSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'key must be lowercase kebab/snake'),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  subject: z.string().min(1).max(255),
  bodyHtml: z.string().min(1).max(50_000),
  bodyText: z.string().min(1).max(50_000),
  fromName: z.string().max(120).optional().nullable(),
  replyTo: z.string().email().optional().nullable(),
  variables: z.array(variableNameSchema).default([]),
  status: z.enum(['active', 'inactive']).default('active'),
});

export const updateEmailTemplateSchema = createEmailTemplateSchema
  .partial()
  .omit({ key: true });

export const previewEmailTemplateSchema = z.object({
  subject: z.string().min(1).max(255).optional(),
  bodyHtml: z.string().min(1).max(50_000).optional(),
  bodyText: z.string().min(1).max(50_000).optional(),
  fromName: z.string().max(120).optional().nullable(),
  replyTo: z.string().email().optional().nullable(),
  variables: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});

export type CreateEmailTemplateInput = z.infer<typeof createEmailTemplateSchema>;
export type UpdateEmailTemplateInput = z.infer<typeof updateEmailTemplateSchema>;
export type PreviewEmailTemplateInput = z.infer<typeof previewEmailTemplateSchema>;
