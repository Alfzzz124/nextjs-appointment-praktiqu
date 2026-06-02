// src/app/(dashboard)/settings/notes-templates/[id]/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { NoteTemplateEditor } from '@/components/notes-templates/editor';

export default function EditNoteTemplatePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [initial, setInitial] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/v1/notes-templates/${params.id}`)
      .then((r) => r.json())
      .then((data) => {
        setInitial(data);
        setLoading(false);
      });
  }, [params.id]);

  async function onSave(data: any) {
    const res = await fetch(`/api/v1/notes-templates/${params.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Save failed');
    router.push('/settings/notes-templates');
  }

  if (loading) return <div className="p-6">Loading…</div>;
  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Edit Note Template</h1>
      <NoteTemplateEditor initial={initial} onSave={onSave} />
    </div>
  );
}
