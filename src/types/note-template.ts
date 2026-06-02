// src/types/note-template.ts
export interface NoteTemplate {
  id: string;
  clinicId?: string | null;
  ownerId?: string | null;
  name: string;
  description?: string | null;
  content: string;
  variables?: string[] | null;
  category?: string | null;
  status: number;
  createdAt: Date;
  updatedAt: Date;
}

export type NoteTemplateCreate = Omit<NoteTemplate, 'id' | 'createdAt' | 'updatedAt' | 'status'>;
export type NoteTemplateUpdate = Partial<NoteTemplateCreate>;
