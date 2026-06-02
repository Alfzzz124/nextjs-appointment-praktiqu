/**
 * Type definitions for the Custom Fields feature (016).
 *
 * Source of truth: specs/016-custom-fields/spec.md
 *
 * `CustomField` is the *definition* of a field (label, type, options, required).
 * `CustomFieldValue` is the per-record value bound to an entity (client, appointment,
 * session note). The value type depends on the field's `fieldType`:
 *
 *   - text           -> string
 *   - number         -> number
 *   - date           -> string (ISO 8601)
 *   - select         -> string (one of `options`)
 *   - multi-select   -> string[]
 *   - boolean        -> boolean
 *
 * Entity types that can carry custom fields:
 *   - client
 *   - appointment
 *   - session_note
 */

import { z } from 'zod';

// -------------------------------------------------------------
// Enums / unions
// -------------------------------------------------------------

export const FieldTypeEnum = z.enum([
  'text',
  'number',
  'date',
  'select',
  'multi-select',
  'boolean',
]);
export type FieldType = z.infer<typeof FieldTypeEnum>;

export const EntityTypeEnum = z.enum(['client', 'appointment', 'session_note']);
export type EntityType = z.infer<typeof EntityTypeEnum>;

// -------------------------------------------------------------
// Field definition
// -------------------------------------------------------------

export interface CustomField {
  id: string;
  entityType: EntityType;
  fieldName: string; // machine slug, e.g. "intake_form"
  fieldLabel: string; // human label, e.g. "Intake form"
  fieldType: FieldType;
  required: boolean;
  options: string[]; // for select / multi-select
  placeholder: string | null;
  clinicId: string | null;
  order: number;
  status: number; // 0 = inactive, 1 = active
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

// -------------------------------------------------------------
// Field value
// -------------------------------------------------------------

export type CustomFieldValueScalar =
  | string
  | number
  | boolean
  | null
  | string[];

export interface CustomFieldValue {
  id: string;
  entityType: EntityType;
  entityId: string;
  fieldId: string;
  value: CustomFieldValueScalar;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

// -------------------------------------------------------------
// Request payloads
// -------------------------------------------------------------

const FieldOptionsSchema = z
  .array(z.string().min(1).max(200))
  .max(50)
  .optional();

export const CreateFieldInputSchema = z.object({
  entityType: EntityTypeEnum,
  fieldName: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'fieldName must be snake_case (a-z0-9_)'),
  fieldLabel: z.string().min(1).max(200),
  fieldType: FieldTypeEnum,
  required: z.boolean().default(false),
  options: FieldOptionsSchema,
  placeholder: z.string().max(200).optional(),
  clinicId: z.string().optional(),
  order: z.number().int().min(0).max(10_000).default(0),
});

export type CreateFieldInput = z.infer<typeof CreateFieldInputSchema>;

export const UpdateFieldInputSchema = CreateFieldInputSchema.partial();
export type UpdateFieldInput = z.infer<typeof UpdateFieldInputSchema>;

export const ListFieldsQuerySchema = z.object({
  entityType: EntityTypeEnum.optional(),
  clinicId: z.string().optional(),
  status: z.coerce.number().int().min(0).max(1).optional(),
});
export type ListFieldsQuery = z.infer<typeof ListFieldsQuerySchema>;

// -------------------------------------------------------------
// Value payloads
// -------------------------------------------------------------

/** A single value payload — must match the field's `fieldType`. */
export const FieldValueInputSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);
export type FieldValueInput = z.infer<typeof FieldValueInputSchema>;

export const SetValuesInputSchema = z.object({
  values: z
    .record(z.string().min(1), FieldValueInputSchema)
    .refine((v) => Object.keys(v).length > 0, 'values cannot be empty'),
});
export type SetValuesInput = z.infer<typeof SetValuesInputSchema>;

// -------------------------------------------------------------
// Error codes (RFC 7807 type slugs)
// -------------------------------------------------------------

export const CustomFieldErrorCodes = {
  FIELD_NOT_FOUND: 'custom_field_not_found',
  VALUE_NOT_FOUND: 'custom_field_value_not_found',
  FIELD_NAME_TAKEN: 'custom_field_name_taken',
  VALUE_VALIDATION_FAILED: 'custom_field_value_validation_failed',
  REQUIRED_FIELD_MISSING: 'custom_field_required_field_missing',
  ENTITY_NOT_FOUND: 'custom_field_entity_not_found',
  FORBIDDEN: 'forbidden',
  VALIDATION_FAILED: 'validation_failed',
} as const;

export type CustomFieldErrorCode =
  (typeof CustomFieldErrorCodes)[keyof typeof CustomFieldErrorCodes];
