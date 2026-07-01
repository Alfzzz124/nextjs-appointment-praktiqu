/**
 * Custom Field service (016).
 *
 * Source of truth: specs/016-custom-fields/spec.md
 *
 * `CustomField` is the *definition* of a field (label, type, options, required).
 * `CustomFieldData` is the per-record *value* bound to an entity (client,
 * appointment, session note).
 *
 * All Prisma access is funnelled through a single injected client so unit
 * tests can pass a stub.
 */

import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';

// Field types — must match spec FR-15.01
export const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'multi-select',
  'boolean',
  'email',
  'phone',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Entity types a custom field can attach to. */
export const MODULE_TYPES = ['client', 'appointment', 'session_note'] as const;
export type ModuleType = (typeof MODULE_TYPES)[number];

// ----------------------------------------------------------------
// Schemas (Zod)
// ----------------------------------------------------------------

export const customFieldCreateSchema = z.object({
  moduleType: z.enum(MODULE_TYPES),
  fieldLabel: z.string().min(1).max(255),
  fieldName: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'fieldName must be snake_case (a-z0-9_)')
    .optional(),
  fieldType: z.enum(FIELD_TYPES),
  options: z.array(z.string().min(1).max(200)).max(50).optional(),
  placeholder: z.string().max(255).optional(),
  isRequired: z.boolean().default(false),
  clinicId: z.string().optional(),
  order: z.number().int().min(0).max(10_000).default(0),
});

export const customFieldUpdateSchema = customFieldCreateSchema.partial();

export const customFieldValueSchema = z.object({
  moduleType: z.enum(MODULE_TYPES),
  moduleId: z.string().min(1),
  fieldId: z.string().min(1),
  fieldValue: z.unknown(),
});

export const customFieldBulkValuesSchema = z.object({
  values: z
    .record(z.string().min(1), z.unknown())
    .refine((v) => Object.keys(v).length > 0, 'values cannot be empty'),
});

export type CustomFieldCreate = z.infer<typeof customFieldCreateSchema>;
export type CustomFieldUpdate = z.infer<typeof customFieldUpdateSchema>;
export type CustomFieldValueInput = z.infer<typeof customFieldValueSchema>;
export type CustomFieldBulkValues = z.infer<typeof customFieldBulkValuesSchema>;

// ----------------------------------------------------------------
// Errors (RFC 7807 type slugs)
// ----------------------------------------------------------------

export const CustomFieldErrorCodes = {
  FIELD_NOT_FOUND: 'custom_field_not_found',
  FIELD_NAME_TAKEN: 'custom_field_name_taken',
  VALUE_VALIDATION_FAILED: 'custom_field_value_validation_failed',
  REQUIRED_FIELD_MISSING: 'custom_field_required_field_missing',
  VALIDATION_FAILED: 'validation_failed',
} as const;

export class CustomFieldError extends Error {
  readonly code: (typeof CustomFieldErrorCodes)[keyof typeof CustomFieldErrorCodes];
  readonly status: number;
  readonly details?: unknown;
  constructor(
    code: (typeof CustomFieldErrorCodes)[keyof typeof CustomFieldErrorCodes],
    message: string,
    status: number,
    details?: unknown,
  ) {
    super(message);
    this.name = 'CustomFieldError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// ----------------------------------------------------------------
// Service
// ----------------------------------------------------------------

export interface CustomFieldWithValue {
  field: {
    id: string;
    moduleType: ModuleType;
    fieldLabel: string;
    fieldType: FieldType;
    options: string[] | null;
    placeholder: string | null;
    isRequired: boolean;
    clinicId: string | null;
    order: number;
    status: number;
  };
  value: unknown | null;
}

export class CustomFieldService {
  constructor(private prisma: PrismaClient) {}

  // ---------- Field definitions ----------

  async listFields(opts: { moduleType?: ModuleType; clinicId?: string; status?: number } = {}) {
    return this.prisma.customField.findMany({
      where: {
        status: opts.status ?? 1,
        ...(opts.moduleType ? { moduleType: opts.moduleType } : {}),
        ...(opts.clinicId ? { clinicId: opts.clinicId } : {}),
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async getField(id: string) {
    return this.prisma.customField.findUnique({ where: { id } });
  }

  async createField(data: CustomFieldCreate) {
    const parsed = customFieldCreateSchema.parse(data);
    if (
      (parsed.fieldType === 'select' || parsed.fieldType === 'multi-select') &&
      (!parsed.options || parsed.options.length === 0)
    ) {
      throw new CustomFieldError(
        CustomFieldErrorCodes.VALIDATION_FAILED,
        `${parsed.fieldType} field requires a non-empty options array`,
        400,
      );
    }
    const existing = await this.prisma.customField.findFirst({
      where: { moduleType: parsed.moduleType, fieldLabel: parsed.fieldLabel, status: 1 },
    });
    if (existing) {
      throw new CustomFieldError(
        CustomFieldErrorCodes.FIELD_NAME_TAKEN,
        'a custom field with this label already exists for the entity type',
        409,
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.prisma.customField.create({ data: parsed as any });
  }

  async updateField(id: string, data: CustomFieldUpdate) {
    const parsed = customFieldUpdateSchema.parse(data);
    return this.prisma.customField.update({ where: { id }, data: parsed });
  }

  async deleteField(id: string) {
    return this.prisma.customField.update({ where: { id }, data: { status: 0 } });
  }

  // ---------- Field values ----------

  async getValues(moduleType: ModuleType, moduleId: string) {
    return this.prisma.customFieldData.findMany({
      where: { moduleType, moduleId },
      include: { field: true },
    });
  }

  async getValuesWithFields(
    moduleType: ModuleType,
    moduleId: string,
  ): Promise<CustomFieldWithValue[]> {
    const fields = await this.prisma.customField.findMany({
      where: { moduleType, status: 1 },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    }) as Array<{
      id: string;
      moduleType: string;
      fieldLabel: string;
      fieldType: string;
      options: unknown;
      placeholder: string | null;
      isRequired: boolean;
      clinicId: string | null;
      order: number;
      status: number;
    }>;
    const values = await this.prisma.customFieldData.findMany({ where: { moduleType, moduleId } }) as Array<{ fieldId: string; fieldValue: unknown }>;
    const valueByFieldId = new Map(values.map((v) => [v.fieldId, v.fieldValue]));
    return fields.map((f) => ({
      field: {
        id: f.id,
        moduleType: f.moduleType as ModuleType,
        fieldLabel: f.fieldLabel,
        fieldType: f.fieldType as FieldType,
        options: Array.isArray(f.options) ? (f.options as string[]) : null,
        placeholder: f.placeholder,
        isRequired: f.isRequired,
        clinicId: f.clinicId,
        order: f.order,
        status: f.status,
      },
      value: valueByFieldId.get(f.id) ?? null,
    }));
  }

  async setValue(input: CustomFieldValueInput) {
    const parsed = customFieldValueSchema.parse(input);
    // Validate against the field's definition
    const field = await this.prisma.customField.findUnique({ where: { id: parsed.fieldId } });
    if (!field) {
      throw new CustomFieldError(
        CustomFieldErrorCodes.FIELD_NOT_FOUND,
        'custom field not found',
        404,
      );
    }
    const err = this.validateValue(
      { fieldType: field.fieldType, options: field.options, isRequired: field.isRequired },
      parsed.fieldValue,
    );
    if (err) {
      throw new CustomFieldError(
        CustomFieldErrorCodes.VALUE_VALIDATION_FAILED,
        err,
        400,
      );
    }
    return this.prisma.customFieldData.upsert({
      where: {
        moduleType_moduleId_fieldId: {
          moduleType: parsed.moduleType,
          moduleId: parsed.moduleId,
          fieldId: parsed.fieldId,
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: parsed as any,
      update: { fieldValue: parsed.fieldValue as never },
    });
  }

  /** Bulk-set multiple field values for a single entity. */
  async setBulkValues(
    moduleType: ModuleType,
    moduleId: string,
    input: CustomFieldBulkValues,
  ) {
    const parsed = customFieldBulkValuesSchema.parse(input);
    const fieldIds = Object.keys(parsed.values);
    const fields = await this.prisma.customField.findMany({
      where: { id: { in: fieldIds }, moduleType, status: 1 },
    });
    if (fields.length !== fieldIds.length) {
      const found = new Set(fields.map((f: { id: string }) => f.id));
      const missing = fieldIds.filter((id) => !found.has(id));
      throw new CustomFieldError(
        CustomFieldErrorCodes.FIELD_NOT_FOUND,
        `unknown field(s): ${missing.join(', ')}`,
        400,
      );
    }
    for (const field of fields as Array<{ fieldType: string; options: unknown; isRequired: boolean; id: string }>) {
      const err = this.validateValue(
        { fieldType: field.fieldType, options: field.options, isRequired: field.isRequired },
        parsed.values[field.id],
      );
      if (err) {
        throw new CustomFieldError(CustomFieldErrorCodes.VALUE_VALIDATION_FAILED, err, 400);
      }
    }
    const ops = fields.map((field: { id: string }) =>
      this.prisma.customFieldData.upsert({
        where: {
          moduleType_moduleId_fieldId: {
            moduleType,
            moduleId,
            fieldId: field.id,
          },
        },
        create: { moduleType, moduleId, fieldId: field.id, fieldValue: parsed.values[field.id] as never },
        update: { fieldValue: parsed.values[field.id] as never },
      }),
    );
    await this.prisma.$transaction(ops);
    return this.getValues(moduleType, moduleId);
  }

  async bulkSetCustomFieldStatus(ids: string[], status: number): Promise<number> {
    const result = await this.prisma.customField.updateMany({
      where: { id: { in: ids } },
      data: { status },
    });
    return result.count;
  }

  async saveCustomFieldData(
    entityType: string,
    entityId: string,
    fieldId: string,
    value: unknown,
  ): Promise<void> {
    await this.prisma.customFieldData.upsert({
      where: {
        moduleType_moduleId_fieldId: {
          moduleType: entityType as ModuleType,
          moduleId: entityId,
          fieldId,
        },
      },
      create: { moduleType: entityType as ModuleType, moduleId: entityId, fieldId, fieldValue: value as never },
      update: { fieldValue: value as never },
    });
  }

  async getCustomFieldData(entityType: string, entityId: string): Promise<unknown[]> {
    return this.prisma.customFieldData.findMany({
      where: { moduleType: entityType as ModuleType, moduleId: entityId },
      include: { field: true },
    });
  }

  /** Validate a value against its field definition. Returns null on success or an error message. */
  validateValue(
    field: { fieldType: string; options: unknown; isRequired: boolean },
    value: unknown,
  ): string | null {
    if (value === undefined || value === null || value === '') {
      return field.isRequired ? 'Field is required' : null;
    }
    switch (field.fieldType) {
      case 'number':
        if (typeof value !== 'number' && !/^-?\d+(\.\d+)?$/.test(String(value))) {
          return 'Must be numeric';
        }
        return null;
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) return 'Invalid email';
        return null;
      case 'phone':
        if (!/^[+0-9 ()\-]{6,}$/.test(String(value))) return 'Invalid phone';
        return null;
      case 'date':
        if (Number.isNaN(Date.parse(String(value)))) return 'Invalid date';
        return null;
      case 'boolean':
        if (
          typeof value !== 'boolean' &&
          !['true', 'false', '0', '1'].includes(String(value).toLowerCase())
        ) {
          return 'Invalid boolean';
        }
        return null;
      case 'select': {
        const options = (field.options as string[] | null) ?? [];
        if (!options.includes(String(value))) return 'Option not allowed';
        return null;
      }
      case 'multi-select': {
        const options = (field.options as string[] | null) ?? [];
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) {
          if (!options.includes(String(v))) return 'Option not allowed';
        }
        return null;
      }
      case 'text':
      case 'textarea':
      default:
        return null;
    }
  }
}
