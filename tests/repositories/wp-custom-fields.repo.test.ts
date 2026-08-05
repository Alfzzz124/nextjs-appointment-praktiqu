/**
 * Contract tests for the custom-field repository over KiviCare's own tables.
 *
 * Replaces the `custom_fields` / `custom_field_data` shadow tables. The risky part is
 * the JSON: KiviCare stores ONE field definition per row inside the `fields` column
 * (SettingsController/CustomFields.php:520 writes `json_encode($fields[0])`), and it
 * writes `isRequired` / `status` as STRINGS, not booleans.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../billing/fixtures';
import {
  createCustomField,
  deleteCustomFieldValues,
  findCustomFieldById,
  fromKcModuleType,
  listCustomFieldValues,
  listCustomFields,
  setCustomFieldStatus,
  setCustomFieldValue,
  toKcModuleType,
  updateCustomField,
} from '@/repositories/wp/custom-fields.repo';

/** Test-owned range, in the same convention as the sibling repository suites. */
const BASE = 8_600_000;
const END = BASE + 100_000;
const ENTITY = BASE + 42;

async function wipe() {
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_custom_fields WHERE id >= ? AND id < ?`, BASE, END,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_custom_fields_data WHERE id >= ? AND id < ? OR module_id = ?`,
    BASE, END, ENTITY,
  );
}

let createdIds: number[] = [];

beforeAll(async () => {
  assertTestDb();
  await wipe();
});

afterAll(async () => {
  for (const id of createdIds) {
    await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_custom_fields WHERE id = ?`, id);
    await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_custom_fields_data WHERE field_id = ?`, id);
  }
  await wipe();
  await prisma.$disconnect();
});

describe('module type vocabulary', () => {
  it('maps our names onto KiviCare slugs', () => {
    expect(toKcModuleType('client')).toBe('patient_module');
    expect(toKcModuleType('appointment')).toBe('appointment_module');
    // A session note IS an encounter — the same equivalence the encounter plan rests on.
    expect(toKcModuleType('session_note')).toBe('patient_encounter_module');
  });

  it('round-trips', () => {
    expect(fromKcModuleType('patient_module')).toBe('client');
    expect(fromKcModuleType('appointment_module')).toBe('appointment');
  });

  it('returns null for a KiviCare module we do not expose', () => {
    // doctor_module and billing_module exist in KiviCare; surfacing them as one of ours
    // would be a lie.
    expect(fromKcModuleType('doctor_module')).toBeNull();
    expect(fromKcModuleType(null)).toBeNull();
  });
});

describe('field definitions', () => {
  it('creates a field and reads it back through the JSON blob', async () => {
    const id = await createCustomField({
      moduleType: 'client',
      label: 'Rujukan Dari',
      fieldType: 'select',
      options: ['Instagram', 'Teman', 'Dokter'],
      placeholder: 'Pilih sumber',
      isRequired: true,
      doctorId: 0,
    });
    createdIds.push(id);

    const f = await findCustomFieldById(id);
    expect(f).not.toBeNull();
    expect(f!.label).toBe('Rujukan Dari');
    expect(f!.fieldType).toBe('select');
    expect(f!.options).toEqual(['Instagram', 'Teman', 'Dokter']);
    expect(f!.placeholder).toBe('Pilih sumber');
    expect(f!.isRequired).toBe(true);
    expect(f!.isActive).toBe(true);
    expect(f!.moduleType).toBe('client');
  });

  it('writes isRequired as the STRING KiviCare expects, not a boolean', async () => {
    const id = createdIds[0];
    const row = await prisma.kcCustomField.findUnique({
      where: { id: BigInt(id) },
      select: { fields: true, moduleType: true },
    });
    const json = JSON.parse(row!.fields!);

    expect(json.isRequired).toBe('1');
    expect(json.status).toBe('1');
    // KiviCare's own reader falls back to `name`; omitting it renders the field blank
    // in the WP admin.
    expect(json.name).toBe('Rujukan Dari');
    expect(row!.moduleType).toBe('patient_module');
  });

  it('merges an update rather than replacing the whole definition', async () => {
    const id = createdIds[0];

    await updateCustomField(id, { placeholder: 'Pilih salah satu' });

    const f = await findCustomFieldById(id);
    expect(f!.placeholder).toBe('Pilih salah satu');
    // Untouched keys survive — the blob holds the entire definition.
    expect(f!.options).toEqual(['Instagram', 'Teman', 'Dokter']);
    expect(f!.isRequired).toBe(true);
    expect(f!.label).toBe('Rujukan Dari');
  });

  it('lists only active fields unless asked otherwise', async () => {
    const id = createdIds[0];
    await setCustomFieldStatus([id], 0);

    const active = await listCustomFields({ moduleType: 'client' });
    expect(active.map((f) => f.id)).not.toContain(id);

    const all = await listCustomFields({ moduleType: 'client', includeInactive: true });
    expect(all.map((f) => f.id)).toContain(id);

    await setCustomFieldStatus([id], 1);
  });

  it('survives a malformed definition instead of throwing', async () => {
    // One corrupt row must not take down the whole settings screen.
    const id = BASE + 900;
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_custom_fields (id, module_type, module_id, fields, status, created_at)
       VALUES (?, 'patient_module', 0, '{not json', 1, NOW())`,
      id,
    );
    createdIds.push(id);

    const f = await findCustomFieldById(id);
    expect(f).not.toBeNull();
    expect(f!.label).toBe('');
    expect(f!.fieldType).toBe('text');
  });
});

describe('values', () => {
  it('stores and reads a value for one entity', async () => {
    const fieldId = createdIds[0];

    await setCustomFieldValue({
      moduleType: 'client',
      moduleId: ENTITY,
      fieldId,
      value: 'Instagram',
    });

    const values = await listCustomFieldValues({ moduleType: 'client', moduleId: ENTITY });
    expect(values).toHaveLength(1);
    expect(values[0].value).toBe('Instagram');
    expect(values[0].fieldId).toBe(fieldId);
  });

  it('updates in place rather than adding a second row', async () => {
    // The natural key has no unique index in KiviCare's schema, so the upsert is done
    // by hand — this is the test that it actually upserts.
    const fieldId = createdIds[0];

    await setCustomFieldValue({ moduleType: 'client', moduleId: ENTITY, fieldId, value: 'Teman' });

    const values = await listCustomFieldValues({ moduleType: 'client', moduleId: ENTITY });
    expect(values).toHaveLength(1);
    expect(values[0].value).toBe('Teman');
  });

  it('round-trips a non-scalar value', async () => {
    const fieldId = createdIds[0];
    await setCustomFieldValue({
      moduleType: 'client',
      moduleId: ENTITY,
      fieldId,
      value: ['Instagram', 'Teman'],
    });

    const values = await listCustomFieldValues({ moduleType: 'client', moduleId: ENTITY });
    expect(values[0].value).toEqual(['Instagram', 'Teman']);
  });

  it('keeps entities separate', async () => {
    const other = await listCustomFieldValues({ moduleType: 'client', moduleId: ENTITY + 1 });
    expect(other).toEqual([]);
  });

  it('purges every value for a field', async () => {
    const fieldId = createdIds[0];
    const removed = await deleteCustomFieldValues(fieldId);

    expect(removed).toBeGreaterThan(0);
    expect(await listCustomFieldValues({ moduleType: 'client', moduleId: ENTITY })).toEqual([]);
  });
});
