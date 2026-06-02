// src/components/email-templates/editor.tsx
'use client';
import { useMemo, useState } from 'react';
import { EmailPreviewService, type EmailTemplateLike } from '@/services/email-templates/preview';

const previewService = new EmailPreviewService();

export interface EmailTemplateEditorProps {
  initial?: Partial<EmailTemplateLike>;
  onSave: (data: EmailTemplateLike) => Promise<void>;
}

export function EmailTemplateEditor({ initial, onSave }: EmailTemplateEditorProps) {
  const [key, setKey] = useState(initial?.key ?? '');
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [valuesText, setValuesText] = useState('');
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewSubject, setPreviewSubject] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detected = useMemo(() => {
    const tpl: EmailTemplateLike = { key, subject, body };
    return previewService.listVariables(tpl);
  }, [key, subject, body]);

  function buildValues() {
    const out: Record<string, string> = {};
    for (const line of valuesText.split(/\n+/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) continue;
      out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
    return out;
  }

  function handlePreview() {
    const result = previewService.preview({
      template: { key, subject, body },
      values: buildValues(),
    });
    setPreviewHtml(result.bodyHtml);
    setPreviewSubject(result.subject);
    setMissing(result.missingVariables);
  }

  async function handleSave() {
    setError(null);
    if (!key.trim()) return setError('Template key required');
    if (!subject.trim() || !body.trim()) return setError('Subject and body required');
    setSaving(true);
    try {
      await onSave({ key, subject, body, variables: detected });
    } catch (e: any) {
      setError(e?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium">Key</label>
          <input
            className="w-full rounded border px-3 py-2 font-mono text-sm"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="appointment.confirmation"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Subject</label>
          <input
            className="w-full rounded border px-3 py-2"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Your appointment is confirmed"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Body (HTML)</label>
          <textarea
            className="h-64 w-full rounded border px-3 py-2 font-mono text-sm"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Sample values (key=value per line)</label>
          <textarea
            className="h-32 w-full rounded border px-3 py-2 font-mono text-sm"
            value={valuesText}
            onChange={(e) => setValuesText(e.target.value)}
            placeholder="client_name=Ada&#10;appointment_date=2026-06-04"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handlePreview}
            className="rounded border border-primary-600 px-3 py-2 text-primary-600"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-primary-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="text-xs text-gray-500">Detected variables: {detected.join(', ') || '—'}</div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-medium">Preview</h3>
        {previewSubject ? (
          <div className="rounded border bg-white p-4">
            <div className="border-b pb-2 text-sm text-gray-500">Subject</div>
            <div className="font-semibold">{previewSubject}</div>
            <div className="mt-3 border-b pb-2 text-sm text-gray-500">Body</div>
            <div dangerouslySetInnerHTML={{ __html: previewHtml ?? '' }} />
            {missing.length > 0 && (
              <p className="mt-3 text-xs text-amber-700">
                Missing values for: {missing.join(', ')}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded border bg-gray-50 p-4 text-sm text-gray-500">Click Preview to render.</div>
        )}
      </div>
    </div>
  );
}

export default EmailTemplateEditor;
