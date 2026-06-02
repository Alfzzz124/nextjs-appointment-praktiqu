// src/app/(dashboard)/settings/notes-templates/new/page.tsx
'use client';
import { useRouter } from 'next/navigation';
import { NoteTemplateEditor } from '@/components/notes-templates/editor';

export default function NewNoteTemplatePage() {
  const router = useRouter();
  async function onSave(data: any) {
    const res = await fetch('/api/v1/notes-templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Save failed');
    router.push('/settings/notes-templates');
  }
  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">New Note Template</h1>
      <NoteTemplateEditor onSave={onSave} />
    </div>
  );
}
