// src/services/notes-templates/service.ts
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';

export const noteTemplateCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  content: z.string().min(1),
  variables: z.array(z.string()).optional(),
  category: z.string().max(64).optional(),
  clinicId: z.string().optional(),
  ownerId: z.string().optional(),
});

export const noteTemplateUpdateSchema = noteTemplateCreateSchema.partial();

export type NoteTemplateCreate = z.infer<typeof noteTemplateCreateSchema>;
export type NoteTemplateUpdate = z.infer<typeof noteTemplateUpdateSchema>;

export class NoteTemplateService {
  constructor(private prisma: PrismaClient) {}

  async list(opts: { clinicId?: string; ownerId?: string; category?: string; status?: number } = {}) {
    return this.prisma.noteTemplate.findMany({
      where: {
        ...(opts.clinicId ? { clinicId: opts.clinicId } : {}),
        ...(opts.ownerId ? { ownerId: opts.ownerId } : {}),
        ...(opts.category ? { category: opts.category } : {}),
        ...(typeof opts.status === 'number' ? { status: opts.status } : { status: 1 }),
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async get(id: string) {
    return this.prisma.noteTemplate.findUnique({ where: { id } });
  }

  async create(data: NoteTemplateCreate) {
    const parsed = noteTemplateCreateSchema.parse(data);
    return this.prisma.noteTemplate.create({
      data: {
        name: parsed.name,
        content: parsed.content,
        description: parsed.description,
        variables: parsed.variables ?? undefined,
        category: parsed.category,
        clinicId: parsed.clinicId,
        ownerId: parsed.ownerId,
      },
    });
  }

  async update(id: string, data: NoteTemplateUpdate) {
    const parsed = noteTemplateUpdateSchema.parse(data);
    return this.prisma.noteTemplate.update({ where: { id }, data: parsed });
  }

  async delete(id: string) {
    return this.prisma.noteTemplate.update({
      where: { id },
      data: { status: 0 },
    });
  }

  // Render template by substituting {{variable}} placeholders
  render(content: string, variables: Record<string, string>): string {
    return content.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
      const value = variables[key];
      return value === undefined ? `{{${key}}}` : value;
    });
  }
}
