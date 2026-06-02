// src/components/consent/form-builder.tsx
'use client';
import { useState } from 'react';

export function ConsentFormBuilder({ onSave }: { onSave: (data: { name: string; content: string }) => Promise<void> }) {
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    if (!name.trim() || !content.trim()) return setError('Name and content required');
    setSaving(true);
    try {
      await onSave({ name, content });
    } catch (e: any) {
      setError(e?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium">Form Name</label>
        <input className="w-full rounded border px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="block text-sm font-medium">Content (HTML supported)</label>
        <textarea className="h-64 w-full rounded border px-3 py-2" value={content} onChange={(e) => setContent(e.target.value)} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="button" onClick={handleSave} disabled={saving} className="rounded bg-primary-600 px-4 py-2 text-white">
        {saving ? 'Saving…' : 'Save form'}
      </button>
    </div>
  );
}

export default ConsentFormBuilder;