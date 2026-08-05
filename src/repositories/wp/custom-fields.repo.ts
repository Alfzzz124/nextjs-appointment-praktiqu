/**
 * Custom fields, from KiviCare's own tables.
 *
 * Replaces the `custom_fields` / `custom_field_data` shadow tables. Those were the same
 * failure as the `clients` one: our copies held 0 rows while KiviCare's held 169 real
 * values (114 on appointments, 55 on encounters), and the app read the empty copies.
 *
 * Reads AND writes are direct SQL. That is the clinic-sessions exception, on the same
 * evidence: KiviCare declares no `do_action` anywhere in its custom-field paths, so a
 * direct write skips no listener. See docs/architecture/shadow-tables-audit.md §6 D1.
 *
 * Ids are `number` — `wp_kc_custom_fields.id` and the entity ids in `module_id`.
 */
import { prisma } from '@/lib/db';

/* ------------------------------------------------------------------ */
/* Module vocabulary                                                   */
/* ------------------------------------------------------------------ */

/**
 * Our module names ↔ KiviCare's `module_type` slugs.
 *
 * `session_note` maps to `patient_encounter_module` because a session note IS a
 * KiviCare encounter — the same equivalence the encounter migration rests on.
 */
export const MODULE_TYPE_TO_KC = {
  client: 'patient_module',
  appointment: 'appointment_module',
  session_note: 'patient_encounter_module',
} as const;

export type ModuleType = keyof typeof MODULE_TYPE_TO_KC;
export type KcModuleType = (typeof MODULE_TYPE_TO_KC)[ModuleType];

const KC_TO_MODULE_TYPE = Object.fromEntries(
  Object.entries(MODULE_TYPE_TO_KC).map(([ours, theirs]) => [theirs, ours]),
) as Record<string, ModuleType>;

export function toKcModuleType(m: ModuleType): KcModuleType {
  return MODULE_TYPE_TO_KC[m];
}

/** Returns null for a KiviCare module we do not expose (doctor_module, billing_module…). */
export function fromKcModuleType(kc: string | null): ModuleType | null {
  return kc === null ? null : (KC_TO_MODULE_TYPE[kc] ?? null);
}

/* ------------------------------------------------------------------ */
/* Field definitions                                                   */
/* ------------------------------------------------------------------ */

export type WpCustomField = {
  id: number;
  moduleType: ModuleType | null;
  /** Doctor this field is scoped to; 0 (or null) means every doctor. */
  doctorId: number;
  label: string;
  fieldType: string;
  options: string[];
  placeholder: string | null;
  isRequired: boolean;
  isActive: boolean;
  createdAt: Date | null;
};

/**
 * The JSON KiviCare writes into `fields` — one field per row.
 *
 * `isRequired` and `status` are STRINGS ('0'/'1') there, not booleans; the controller
 * casts them explicitly (SettingsController/CustomFields.php:496-499). Anything falsy
 * or absent reads as false, which is the safe default for `required`.
 */
type KcFieldJson = {
  label?: string;
  type?: string;
  name?: string;
  options?: unknown;
  file_upload_type?: unknown;
  isRequired?: string | number | boolean;
  placeholder?: string;
  status?: string | number;
};

function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function decodeField(raw: string | null): KcFieldJson {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // A malformed definition degrades to an unnamed text field rather than throwing —
    // one bad row must not take down the whole settings screen.
    return {};
  }
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter((s) => s !== '');
}

type FieldRow = {
  id: bigint;
  moduleType: string | null;
  moduleId: bigint | null;
  fields: string | null;
  status: number;
  createdAt: Date | null;
};

function toField(row: FieldRow): WpCustomField {
  const f = decodeField(row.fields);
  return {
    id: Number(row.id),
    moduleType: fromKcModuleType(row.moduleType),
    doctorId: row.moduleId === null ? 0 : Number(row.moduleId),
    label: f.label ?? f.name ?? '',
    fieldType: f.type ?? 'text',
    options: toStringArray(f.options),
    placeholder: f.placeholder && f.placeholder !== '' ? f.placeholder : null,
    isRequired: truthy(f.isRequired),
    // The column is authoritative; the copy inside the JSON can drift.
    isActive: row.status === 1,
    createdAt: row.createdAt,
  };
}

const FIELD_SELECT = {
  id: true,
  moduleType: true,
  moduleId: true,
  fields: true,
  status: true,
  createdAt: true,
} as const;

export async function findCustomFieldById(id: number): Promise<WpCustomField | null> {
  const row = await prisma.kcCustomField.findUnique({
    where: { id: BigInt(id) },
    select: FIELD_SELECT,
  });
  return row ? toField(row as FieldRow) : null;
}

export async function listCustomFields(query: {
  moduleType?: ModuleType;
  /** Include fields scoped to this doctor as well as the all-doctor ones (module_id 0). */
  doctorId?: number;
  includeInactive?: boolean;
} = {}): Promise<WpCustomField[]> {
  const where: Record<string, unknown> = {};
  if (query.moduleType) where.moduleType = toKcModuleType(query.moduleType);
  if (!query.includeInactive) where.status = 1;
  if (query.doctorId !== undefined) {
    // 0 means "all doctors", so a doctor-scoped query must see both.
    where.OR = [{ moduleId: BigInt(query.doctorId) }, { moduleId: 0n }, { moduleId: null }];
  }

  const rows = await prisma.kcCustomField.findMany({
    where,
    select: FIELD_SELECT,
    orderBy: { id: 'asc' },
  });
  return (rows as FieldRow[]).map(toField);
}

/* ------------------------------------------------------------------ */
/* Field definition writes                                             */
/* ------------------------------------------------------------------ */

export type CustomFieldInput = {
  moduleType: ModuleType;
  label: string;
  fieldType: string;
  options?: string[];
  placeholder?: string | null;
  isRequired?: boolean;
  doctorId?: number;
  isActive?: boolean;
};

/** Build the JSON blob exactly as KiviCare's own controller does, key for key. */
function encodeField(input: {
  label: string;
  fieldType: string;
  options?: string[];
  placeholder?: string | null;
  isRequired?: boolean;
  isActive?: boolean;
}): string {
  return JSON.stringify({
    label: input.label,
    type: input.fieldType,
    // KiviCare duplicates label into `name` "for compatibility"; its own reader falls
    // back to it, so omitting it would make fields render blank in the WP admin.
    name: input.label,
    options: input.options ?? [],
    file_upload_type: [],
    isRequired: input.isRequired ? '1' : '0',
    placeholder: input.placeholder ?? '',
    status: input.isActive === false ? '0' : '1',
  });
}

export async function createCustomField(input: CustomFieldInput): Promise<number> {
  const created = await prisma.kcCustomField.create({
    data: {
      moduleType: toKcModuleType(input.moduleType),
      moduleId: BigInt(input.doctorId ?? 0),
      fields: encodeField(input),
      status: input.isActive === false ? 0 : 1,
      createdAt: new Date(),
    },
    select: { id: true },
  });
  return Number(created.id);
}

export async function updateCustomField(
  id: number,
  input: Partial<CustomFieldInput>,
): Promise<boolean> {
  const existing = await findCustomFieldById(id);
  if (!existing) return false;

  // Merged, not replaced: the caller may be changing one key, and the blob holds the
  // whole definition.
  const merged = {
    label: input.label ?? existing.label,
    fieldType: input.fieldType ?? existing.fieldType,
    options: input.options ?? existing.options,
    placeholder: input.placeholder === undefined ? existing.placeholder : input.placeholder,
    isRequired: input.isRequired ?? existing.isRequired,
    isActive: input.isActive ?? existing.isActive,
  };

  await prisma.kcCustomField.update({
    where: { id: BigInt(id) },
    data: {
      ...(input.moduleType ? { moduleType: toKcModuleType(input.moduleType) } : {}),
      ...(input.doctorId !== undefined ? { moduleId: BigInt(input.doctorId) } : {}),
      fields: encodeField(merged),
      status: merged.isActive ? 1 : 0,
    },
  });
  return true;
}

/** Soft delete, matching KiviCare's own convention of status 0 rather than DELETE. */
export async function setCustomFieldStatus(ids: number[], status: 0 | 1): Promise<number> {
  if (ids.length === 0) return 0;
  const r = await prisma.kcCustomField.updateMany({
    where: { id: { in: ids.map((n) => BigInt(n)) } },
    data: { status },
  });
  return r.count;
}

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

export type WpCustomFieldValue = {
  id: number;
  fieldId: number | null;
  moduleType: ModuleType | null;
  /** The entity the value belongs to — an appointment id, an encounter id. */
  moduleId: number;
  value: unknown;
  createdAt: Date | null;
};

function decodeValue(raw: string | null): unknown {
  if (raw === null || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    // KiviCare has written bare strings here in older versions; return as-is rather
    // than losing the value.
    return raw;
  }
}

export async function listCustomFieldValues(query: {
  moduleType: ModuleType;
  moduleId: number;
}): Promise<WpCustomFieldValue[]> {
  const rows = await prisma.kcCustomFieldData.findMany({
    where: {
      moduleType: toKcModuleType(query.moduleType),
      moduleId: BigInt(query.moduleId),
    },
    select: {
      id: true,
      fieldId: true,
      moduleType: true,
      moduleId: true,
      fieldsData: true,
      createdAt: true,
    },
    orderBy: { id: 'asc' },
  });

  return rows.map((r) => ({
    id: Number(r.id),
    fieldId: r.fieldId === null ? null : Number(r.fieldId),
    moduleType: fromKcModuleType(r.moduleType),
    moduleId: Number(r.moduleId),
    value: decodeValue(r.fieldsData),
    createdAt: r.createdAt,
  }));
}

/**
 * Set one field's value on one entity.
 *
 * Upsert by hand rather than `prisma.upsert`: the natural key
 * (module_type, module_id, field_id) has no unique index in KiviCare's schema, so
 * Prisma cannot target it.
 */
export async function setCustomFieldValue(input: {
  moduleType: ModuleType;
  moduleId: number;
  fieldId: number;
  value: unknown;
}): Promise<number> {
  const kcModule = toKcModuleType(input.moduleType);
  const encoded = JSON.stringify(input.value ?? null);

  const existing = await prisma.kcCustomFieldData.findFirst({
    where: {
      moduleType: kcModule,
      moduleId: BigInt(input.moduleId),
      fieldId: BigInt(input.fieldId),
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  });

  if (existing) {
    await prisma.kcCustomFieldData.update({
      where: { id: existing.id },
      data: { fieldsData: encoded },
    });
    return Number(existing.id);
  }

  const created = await prisma.kcCustomFieldData.create({
    data: {
      moduleType: kcModule,
      moduleId: BigInt(input.moduleId),
      fieldId: BigInt(input.fieldId),
      fieldsData: encoded,
      createdAt: new Date(),
    },
    select: { id: true },
  });
  return Number(created.id);
}

/** Remove every stored value for one field — used when a field is deleted outright. */
export async function deleteCustomFieldValues(fieldId: number): Promise<number> {
  const r = await prisma.kcCustomFieldData.deleteMany({
    where: { fieldId: BigInt(fieldId) },
  });
  return r.count;
}
