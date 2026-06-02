// tests/unit/notes-templates/service.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NoteTemplateService, noteTemplateCreateSchema } from '@/services/notes-templates/service';

function makePrismaStub() {
  return {
    noteTemplate: {
      findMany: vi.fn().mockResolvedValue([{ id: 't1', name: 'Intake' }]),
      findUnique: vi.fn().mockResolvedValue({ id: 't1', name: 'Intake', content: 'Hello {{name}}' }),
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'new', ...data })),
      update: vi.fn().mockImplementation(async ({ where, data }) => ({ id: where.id, ...data })),
    },
  } as any;
}

describe('NoteTemplateService', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let service: NoteTemplateService;

  beforeEach(() => {
    prisma = makePrismaStub();
    service = new NoteTemplateService(prisma);
  });

  it('lists templates filtered by status', async () => {
    await service.list({ clinicId: 'c1' });
    expect(prisma.noteTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ clinicId: 'c1', status: 1 }) }),
    );
  });

  it('gets a template by id', async () => {
    const t = await service.get('t1');
    expect(t?.id).toBe('t1');
  });

  it('creates with parsed schema', async () => {
    const created = await service.create({ name: 'X', content: 'body' });
    expect(created.id).toBe('new');
    expect(created.name).toBe('X');
  });

  it('rejects invalid create input', () => {
    expect(() => noteTemplateCreateSchema.parse({ name: '', content: '' })).toThrow();
  });

  it('renders variables', () => {
    const out = service.render('Hi {{name}}, on {{date}}', { name: 'Ada', date: '2026-01-01' });
    expect(out).toBe('Hi Ada, on 2026-01-01');
  });

  it('leaves unknown variables intact', () => {
    const out = service.render('Hello {{name}}', {});
    expect(out).toBe('Hello {{name}}');
  });

  it('soft-deletes by setting status=0', async () => {
    prisma.noteTemplate.update = vi.fn().mockResolvedValue({ id: 't1', status: 0 });
    await service.delete('t1');
    expect(prisma.noteTemplate.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: 0 },
    });
  });
});
