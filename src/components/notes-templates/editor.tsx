// src/components/notes-templates/editor.tsx
'use client';
import { useState } from 'react';

export interface NoteTemplateEditorProps {
  initial?: {
    id?: string;
    name?: string;
    description?: string;
    content?: string;
    category?: string;
    variables?: string[];
  };
  onSave: (data: { name: string; description?: string; content: string; category?: string; variables?: string[] }) => Promise<void>;
}

export function NoteTemplateEditor({ initial, onSave }: NoteTemplateEditorProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [variables, setVariables] = useState((initial?.variables ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    if (!name.trim()) return setError('Name required');
    if (!content.trim()) return setError('Content required');
    setSaving(true);
    try {
      await onSave({
        name,
        description: description || undefined,
        content,
        category: category || undefined,
        variables: variables
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      });
    } catch (e: any) {
      setError(e?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium">Name</label>
        <input
          className="w-full rounded border px-3 py-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-sm font-medium">Category</label>
        <input
          className="w-full rounded border px-3 py-2"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="intake, follow-up, discharge"
        />
      </div>
      <div>
        <label className="block text-sm font-medium">Description</label>
        <input
          className="w-full rounded border px-3 py-2"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-sm font-medium">Content (use {'{{variable}}'} placeholders)</label>
        <textarea
          className="h-48 w-full rounded border px-3 py-2 font-mono text-sm"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-sm font-medium">Variables (comma-separated)</label>
        <input
          className="w-full rounded border px-3 py-2"
          value={variables}
          onChange={(e) => setVariables(e.target.value)}
          placeholder="client_name, session_date"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="rounded bg-primary-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save template'}
      </button>
    </div>
  );
}

export default NoteTemplateEditor;
