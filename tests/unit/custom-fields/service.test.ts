// tests/unit/custom-fields/service.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CustomFieldService } from '@/services/custom-fields/service';

function makePrismaStub() {
  return {
    customField: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ id: 'f1', fieldType: 'text' }),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'new', ...data })),
      update: vi.fn().mockImplementation(async ({ where, data }) => ({ id: where.id, ...data })),
    },
    customFieldData: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockImplementation(async ({ create }) => ({ id: 'v1', ...create })),
    },
  } as any;
}

describe('CustomFieldService', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let service: CustomFieldService;

  beforeEach(() => {
    prisma = makePrismaStub();
    service = new CustomFieldService(prisma);
  });

  it('lists fields filtered by module', async () => {
    await service.listFields({ moduleType: 'client' });
    expect(prisma.customField.findMany).toHaveBeenCalled();
  });

  it('creates field', async () => {
    const f = await service.createField({
      moduleType: 'client',
      fieldLabel: 'Emergency Contact',
      fieldType: 'text',
      isRequired: false,
      order: 0,
    });
    expect(f.id).toBe('new');
  });

  it('soft-deletes field', async () => {
    prisma.customField.update = vi.fn().mockResolvedValue({ id: 'f1', status: 0 });
    await service.deleteField('f1');
    expect(prisma.customField.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { status: 0 },
    });
  });

  it('validates required field empty', () => {
    const result = service.validateValue(
      { fieldType: 'text', options: null, isRequired: true },
      '',
    );
    expect(result).toBe('Field is required');
  });

  it('validates email format', () => {
    const ok = service.validateValue({ fieldType: 'email', options: null, isRequired: false }, 'a@b.com');
    const bad = service.validateValue({ fieldType: 'email', options: null, isRequired: false }, 'no-at');
    expect(ok).toBeNull();
    expect(bad).toBe('Invalid email');
  });

  it('validates number format', () => {
    expect(service.validateValue({ fieldType: 'number', options: null, isRequired: false }, '42')).toBeNull();
    expect(service.validateValue({ fieldType: 'number', options: null, isRequired: false }, 'abc')).toBe('Must be numeric');
  });

  it('validates select against options', () => {
    const field = { fieldType: 'select', options: ['a', 'b'], isRequired: false };
    expect(service.validateValue(field, 'a')).toBeNull();
    expect(service.validateValue(field, 'c')).toBe('Option not allowed');
  });

  it('upserts value', async () => {
    await service.setValue({ moduleType: 'client', moduleId: 'c1', fieldId: 'f1', fieldValue: 'X' });
    expect(prisma.customFieldData.upsert).toHaveBeenCalled();
  });
});