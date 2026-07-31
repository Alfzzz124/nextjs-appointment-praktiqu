/**
 * Custom fields — backed by KiviCare's `wp_kc_custom_fields` / `wp_kc_custom_fields_data`.
 *
 * Retires the `custom_fields` / `custom_field_data` shadow tables. Those repeated the
 * `clients` failure exactly: our copies held 0 rows while KiviCare's held 169 real
 * values (114 on appointments, 55 on encounters), and this service read the empty
 * copies. See docs/architecture/shadow-tables-audit.md (Phase 3.9).
 *
 * `CustomField` is the *definition* of a field (label, type, options, required).
 * Values are bound to an entity — a client, an appointment, an encounter.
 *
 * Validation stays here: it is our behaviour, not KiviCare's. `validateValue` is
 * unchanged. Only the storage moved.
 *
 * Ids are `number`: `wp_kc_custom_fields.id` for a field, and the entity's own id for
 * `moduleId`.
 */

import { z } from 'zod';
import {
  MODULE_TYPE_TO_KC,
  createCustomField,
  deleteCustomFieldValues,
  findCustomFieldById,
  listCustomFieldValues,
  listCustomFields,
  setCustomFieldStatus,
  setCustomFieldValue,
  updateCustomField,
  type ModuleType,
  type WpCustomField,
} from '@/repositories/wp/custom-fields.repo';

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
export const MODULE_TYPES = Object.keys(MODULE_TYPE_TO_KC) as [ModuleType, ...ModuleType[]];
export type { ModuleType };

// ----------------------------------------------------------------
// Schemas (Zod)
// ----------------------------------------------------------------

export const customFieldCreateSchema = z.object({
  moduleType: z.enum(MODULE_TYPES),
  fieldLabel: z.string().min(1).max(255),
  fieldType: z.enum(FIELD_TYPES),
  options: z.array(z.string().min(1).max(200)).max(50).optional(),
  placeholder: z.string().max(255).optional(),
  isRequired: z.boolean().default(false),
  /**
   * Restrict the field to one doctor; omit or 0 for every doctor.
   *
   * Replaces the old `clinicId`. KiviCare scopes custom fields by doctor
   * (`wp_kc_custom_fields.module_id`) and has no clinic scoping for them at all, so the
   * old field could never have been honoured by the storage it now writes to.
   */
  doctorId: z.number().int().min(0).optional(),
});

export const customFieldUpdateSchema = customFieldCreateSchema.partial();

export const customFieldValueSchema = z.object({
  moduleType: z.enum(MODULE_TYPES),
  moduleId: z.coerce.number().int().positive(),
  fieldId: z.coerce.number().int().positive(),
  fieldValue: z.unknown(),
});

export const customFieldBulkValuesSchema = z.object({
  values: z
    .record(z.string().regex(/^\d+$/, 'field id must be numeric'), z.unknown())
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
// DTOs
// ----------------------------------------------------------------

export interface CustomFieldDTO {
  id: number;
  moduleType: ModuleType | null;
  fieldLabel: string;
  fieldType: string;
  options: string[] | null;
  placeholder: string | null;
  isRequired: boolean;
  doctorId: number;
  status: number;
}

export interface CustomFieldWithValue {
  field: CustomFieldDTO;
  value: unknown | null;
}

function toDTO(f: WpCustomField): CustomFieldDTO {
  return {
    id: f.id,
    moduleType: f.moduleType,
    fieldLabel: f.label,
    fieldType: f.fieldType,
    options: f.options.length > 0 ? f.options : null,
    placeholder: f.placeholder,
    isRequired: f.isRequired,
    doctorId: f.doctorId,
    status: f.isActive ? 1 : 0,
  };
}

// ----------------------------------------------------------------
// Service
// ----------------------------------------------------------------

export class CustomFieldService {
  // ---------- Field definitions ----------

  async listFields(
    opts: { moduleType?: ModuleType; doctorId?: number; status?: number } = {},
  ): Promise<CustomFieldDTO[]> {
    // Read wide, then filter: `status: 0` means "show me the inactive ones", which the
    // repository's active-only default would otherwise hide.
    const fields = await listCustomFields({
      moduleType: opts.moduleType,
      doctorId: opts.doctorId,
      includeInactive: opts.status !== 1,
    });
    const wanted = opts.status ?? 1;
    return fields.filter((f) => (f.isActive ? 1 : 0) === wanted).map(toDTO);
  }

  async getField(id: number): Promise<CustomFieldDTO | null> {
    const f = await findCustomFieldById(id);
    return f ? toDTO(f) : null;
  }

  async createField(data: CustomFieldCreate): Promise<CustomFieldDTO> {
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

    // Uniqueness is a check-then-write: KiviCare's table has no unique index on
    // (module_type, label), so this narrows the race window rather than closing it.
    const existing = await listCustomFields({ moduleType: parsed.moduleType });
    if (existing.some((f) => f.label === parsed.fieldLabel)) {
      throw new CustomFieldError(
        CustomFieldErrorCodes.FIELD_NAME_TAKEN,
        'a custom field with this label already exists for the entity type',
        409,
      );
    }

    const id = await createCustomField({
      moduleType: parsed.moduleType,
      label: parsed.fieldLabel,
      fieldType: parsed.fieldType,
      options: parsed.options,
      placeholder: parsed.placeholder ?? null,
      isRequired: parsed.isRequired,
      doctorId: parsed.doctorId,
    });

    const created = await findCustomFieldById(id);
    if (!created) {
      throw new CustomFieldError(
        CustomFieldErrorCodes.FIELD_NOT_FOUND,
        'field was created but could not be read back',
        502,
      );
    }
    return toDTO(created);
  }

  async updateField(id: number, data: CustomFieldUpdate): Promise<CustomFieldDTO> {
    const parsed = customFieldUpdateSchema.parse(data);
    const ok = await updateCustomField(id, {
      moduleType: parsed.moduleType,
      label: parsed.fieldLabel,
      fieldType: parsed.fieldType,
      options: parsed.options,
      placeholder: parsed.placeholder,
      isRequired: parsed.isRequired,
      doctorId: parsed.doctorId,
    });
    if (!ok) {
      throw new CustomFieldError(
        CustomFieldErrorCodes.FIELD_NOT_FOUND,
        'custom field not found',
        404,
      );
    }
    return (await this.getField(id))!;
  }

  /** Soft delete — status 0, matching KiviCare's own convention rather than DELETE. */
  async deleteField(id: number): Promise<void> {
    const changed = await setCustomFieldStatus([id], 0);
    if (changed === 0) {
      throw new CustomFieldError(
        CustomFieldErrorCodes.FIELD_NOT_FOUND,
        'custom field not found',
        404,
      );
    }
  }

  /** Hard delete of a field's stored values. Separate from deleteField, which is soft. */
  async purgeFieldValues(fieldId: number): Promise<number> {
    return deleteCustomFieldValues(fieldId);
  }

  // ---------- Values ----------

  async getValues(moduleType: ModuleType, moduleId: number) {
    return listCustomFieldValues({ moduleType, moduleId });
  }

  /**
   * Every active field for the entity type, each with its stored value (or null).
   *
   * Fields with no value are included — that is what lets a form render blanks for
   * fields this entity has never had filled in.
   */
  async getValuesWithFields(
    moduleType: ModuleType,
    moduleId: number,
  ): Promise<CustomFieldWithValue[]> {
    const [fields, values] = await Promise.all([
      listCustomFields({ moduleType }),
      listCustomFieldValues({ moduleType, moduleId }),
    ]);
    const byFieldId = new Map(values.map((v) => [v.fieldId, v.value]));
    return fields.map((f) => ({ field: toDTO(f), value: byFieldId.get(f.id) ?? null }));
  }

  async setValue(input: CustomFieldValueInput) {
    const parsed = customFieldValueSchema.parse(input);
    const field = await findCustomFieldById(parsed.fieldId);
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
      throw new CustomFieldError(CustomFieldErrorCodes.VALUE_VALIDATION_FAILED, err, 400);
    }

    const id = await setCustomFieldValue({
      moduleType: parsed.moduleType,
      moduleId: parsed.moduleId,
      fieldId: parsed.fieldId,
      value: parsed.fieldValue,
    });
    return { id, fieldId: parsed.fieldId, moduleId: parsed.moduleId, value: parsed.fieldValue };
  }

  /**
   * Set several values on one entity.
   *
   * Not wrapped in a transaction: `wp_kc_custom_fields_data` is MyISAM, so one would
   * guarantee nothing — the same trap that made `markBillPaid` look safe. Instead every
   * field is validated BEFORE the first write, so a rejected batch writes nothing at
   * all, which is the property the transaction was there for.
   */
  async setBulkValues(moduleType: ModuleType, moduleId: number, input: CustomFieldBulkValues) {
    const parsed = customFieldBulkValuesSchema.parse(input);
    const fieldIds = Object.keys(parsed.values).map(Number);

    const found = await Promise.all(fieldIds.map((id) => findCustomFieldById(id)));
    const missing = fieldIds.filter((id, i) => {
      const f = found[i];
      return !f || f.moduleType !== moduleType || !f.isActive;
    });
    if (missing.length > 0) {
      throw new CustomFieldError(
        CustomFieldErrorCodes.FIELD_NOT_FOUND,
        `unknown field(s): ${missing.join(', ')}`,
        400,
      );
    }

    const fields = found as WpCustomField[];
    for (const f of fields) {
      const err = this.validateValue(
        { fieldType: f.fieldType, options: f.options, isRequired: f.isRequired },
        parsed.values[String(f.id)],
      );
      if (err) {
        throw new CustomFieldError(CustomFieldErrorCodes.VALUE_VALIDATION_FAILED, err, 400);
      }
    }

    for (const f of fields) {
      await setCustomFieldValue({
        moduleType,
        moduleId,
        fieldId: f.id,
        value: parsed.values[String(f.id)],
      });
    }
    return this.getValues(moduleType, moduleId);
  }

  async bulkSetCustomFieldStatus(ids: number[], status: number): Promise<number> {
    return setCustomFieldStatus(ids, status === 1 ? 1 : 0);
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
