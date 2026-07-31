/**
 * CustomFieldService, now backed by KiviCare's tables.
 *
 * The old suite stubbed `prisma.customField` / `prisma.customFieldData` — the shadow
 * tables that held 0 rows while KiviCare's held 169 real values. The repository is
 * mocked here instead.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/repositories/wp/custom-fields.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/custom-fields.repo')>()),
  findCustomFieldById: vi.fn(),
  listCustomFields: vi.fn(),
  listCustomFieldValues: vi.fn(),
  createCustomField: vi.fn(),
  updateCustomField: vi.fn(),
  setCustomFieldStatus: vi.fn(),
  setCustomFieldValue: vi.fn(),
  deleteCustomFieldValues: vi.fn(),
}));

import { CustomFieldError, CustomFieldService } from '@/services/custom-fields/service';
import {
  createCustomField,
  findCustomFieldById,
  listCustomFieldValues,
  listCustomFields,
  setCustomFieldStatus,
  setCustomFieldValue,
} from '@/repositories/wp/custom-fields.repo';

const FIELD_ID = 7;

function field(overrides: Record<string, unknown> = {}) {
  return {
    id: FIELD_ID,
    moduleType: 'client',
    doctorId: 0,
    label: 'Emergency Contact',
    fieldType: 'text',
    options: [],
    placeholder: null,
    isRequired: false,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('CustomFieldService', () => {
  let service: CustomFieldService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listCustomFields).mockResolvedValue([]);
    vi.mocked(listCustomFieldValues).mockResolvedValue([]);
    vi.mocked(findCustomFieldById).mockResolvedValue(field() as never);
    vi.mocked(setCustomFieldValue).mockResolvedValue(1);
    vi.mocked(setCustomFieldStatus).mockResolvedValue(1);
    service = new CustomFieldService();
  });

  it('lists fields filtered by module', async () => {
    await service.listFields({ moduleType: 'client' });
    expect(vi.mocked(listCustomFields).mock.calls[0][0]).toMatchObject({ moduleType: 'client' });
  });

  it('creates a field and reads it back', async () => {
    vi.mocked(createCustomField).mockResolvedValue(FIELD_ID);

    const f = await service.createField({
      moduleType: 'client',
      fieldLabel: 'Emergency Contact',
      fieldType: 'text',
      isRequired: false,
    });

    expect(f.id).toBe(FIELD_ID);
    expect(f.fieldLabel).toBe('Emergency Contact');
  });

  it('refuses a duplicate label within the same module', async () => {
    vi.mocked(listCustomFields).mockResolvedValue([field() as never]);

    await expect(
      service.createField({
        moduleType: 'client',
        fieldLabel: 'Emergency Contact',
        fieldType: 'text',
        isRequired: false,
      }),
    ).rejects.toBeInstanceOf(CustomFieldError);
  });

  it('refuses a select field with no options', async () => {
    await expect(
      service.createField({
        moduleType: 'client',
        fieldLabel: 'Referral Source',
        fieldType: 'select',
        isRequired: false,
      }),
    ).rejects.toThrow(/requires a non-empty options array/);
  });

  it('soft-deletes a field by setting status 0', async () => {
    await service.deleteField(FIELD_ID);
    expect(setCustomFieldStatus).toHaveBeenCalledWith([FIELD_ID], 0);
  });

  it('404s when deleting a field that does not exist', async () => {
    vi.mocked(setCustomFieldStatus).mockResolvedValue(0);
    await expect(service.deleteField(999)).rejects.toBeInstanceOf(CustomFieldError);
  });

  it('stores a value against the KiviCare field id', async () => {
    await service.setValue({
      moduleType: 'client',
      moduleId: 17,
      fieldId: FIELD_ID,
      fieldValue: 'X',
    });

    expect(setCustomFieldValue).toHaveBeenCalledWith({
      moduleType: 'client',
      moduleId: 17,
      fieldId: FIELD_ID,
      value: 'X',
    });
  });

  it('rejects a value that fails the field definition, before writing', async () => {
    vi.mocked(findCustomFieldById).mockResolvedValue(
      field({ fieldType: 'select', options: ['a', 'b'] }) as never,
    );

    await expect(
      service.setValue({ moduleType: 'client', moduleId: 17, fieldId: FIELD_ID, fieldValue: 'c' }),
    ).rejects.toThrow(/Option not allowed/);
    expect(setCustomFieldValue).not.toHaveBeenCalled();
  });

  it('validates the whole batch before writing any of it', async () => {
    // The property the transaction was there for — and MyISAM could never provide:
    // one bad value must leave the entity untouched, not half-updated.
    vi.mocked(findCustomFieldById).mockImplementation(
      async (id: number) =>
        (id === 8
          ? field({ id: 8, fieldType: 'number' })
          : field({ id: 7, fieldType: 'text' })) as never,
    );

    await expect(
      service.setBulkValues('client', 17, { values: { '7': 'fine', '8': 'not-a-number' } }),
    ).rejects.toThrow(/Must be numeric/);
    expect(setCustomFieldValue).not.toHaveBeenCalled();
  });

  it('pairs every active field with its stored value, including the empty ones', async () => {
    vi.mocked(listCustomFields).mockResolvedValue([
      field({ id: 7 }) as never,
      field({ id: 8, label: 'Allergies' }) as never,
    ]);
    vi.mocked(listCustomFieldValues).mockResolvedValue([
      { id: 1, fieldId: 7, moduleType: 'client', moduleId: 17, value: 'Budi', createdAt: null },
    ] as never);

    const rows = await service.getValuesWithFields('client', 17);

    expect(rows).toHaveLength(2);
    expect(rows[0].value).toBe('Budi');
    // A field never filled in still appears, so a form can render it blank.
    expect(rows[1].value).toBeNull();
  });

  it('validates required field empty', () => {
    expect(service.validateValue({ fieldType: 'text', options: null, isRequired: true }, '')).toBe(
      'Field is required',
    );
  });

  it('validates email format', () => {
    const f = { fieldType: 'email', options: null, isRequired: false };
    expect(service.validateValue(f, 'a@b.com')).toBeNull();
    expect(service.validateValue(f, 'no-at')).toBe('Invalid email');
  });

  it('validates number format', () => {
    const f = { fieldType: 'number', options: null, isRequired: false };
    expect(service.validateValue(f, '42')).toBeNull();
    expect(service.validateValue(f, 'abc')).toBe('Must be numeric');
  });

  it('validates select against options', () => {
    const f = { fieldType: 'select', options: ['a', 'b'], isRequired: false };
    expect(service.validateValue(f, 'a')).toBeNull();
    expect(service.validateValue(f, 'c')).toBe('Option not allowed');
  });
});
