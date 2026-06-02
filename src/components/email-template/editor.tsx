'use client';
/**
 * Template editor component (T004).
 *
 * Two-column layout:
 *   left — form fields (key, name, description, subject, body-html, body-text, from-name, reply-to)
 *   right — live preview pane driven by the render engine
 *
 * Source: specs/018-email-templates/spec.md, tasks.md (T004)
 *
 * Auth: caller (page) is responsible for gating access to CLINIC_ADMIN / SUPER_ADMIN.
 */

import { useMemo, useState } from 'react';
import { extractPlaceholders, htmlToText, renderTemplate } from '@/services/email-templates/preview.service';
import type {
  CreateEmailTemplateInput,
  EmailTemplateDTO,
} from '@/types/email-template';

interface TemplateEditorProps {
  /** Pre-loaded template (null = create mode). */
  initial?: EmailTemplateDTO | null;
  /** Called on save with the payload. Caller POSTs to the API. */
  onSave: (data: CreateEmailTemplateInput) => Promise<void>;
  /** Disable all fields while saving. */
  saving?: boolean;
}

/** Minimal shape used internally for the preview engine. */
interface InternalTemplate {
  subject: string;
  bodyHtml: string;
  bodyText: string;
}

export function TemplateEditor({ initial, onSave, saving = false }: TemplateEditorProps) {
  const [key, setKey] = useState(initial?.key ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [bodyHtml, setBodyHtml] = useState(initial?.bodyHtml ?? '');
  const [bodyText, setBodyText] = useState(initial?.bodyText ?? '');
  const [fromName, setFromName] = useState(initial?.fromName ?? '');
  const [replyTo, setReplyTo] = useState(initial?.replyTo ?? '');
  const [valuesText, setValuesText] = useState(''); // "key=value\n" editor for preview
  const [rendered, setRendered] = useState<RenderedTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Variables auto-detected from all three template fields (sorted). */
  const detectedVariables = useMemo<string[]>(() => {
    const all = [
      ...extractPlaceholders(subject),
      ...extractPlaceholders(bodyHtml),
      ...extractPlaceholders(bodyText),
    ];
    return Array.from(new Set(all)).sort();
  }, [subject, bodyHtml, bodyText]);

  /** Parse the "key=value" lines into a VariableContext. */
  function parseValues(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of valuesText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) continue;
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim();
      out[k] = v;
    }
    return out;
  }

  function handlePreview() {
    setError(null);
    if (!subject.trim() || (!bodyHtml.trim() && !bodyText.trim())) {
      setError('Subject and at least one body (HTML or text) are required for preview.');
      return;
    }
    const tpl: InternalTemplate = { subject, bodyHtml, bodyText };
    const previewValues = parseValues();
    const result = renderTemplate(
      { subject: tpl.subject, bodyHtml: tpl.bodyHtml, bodyText: tpl.bodyText, fromName, replyTo },
      previewValues,
    );
    setRendered(result);
  }

  async function handleSave() {
    setError(null);
    if (!key.trim()) { setError('Template key is required.'); return; }
    if (!name.trim()) { setError('Template name is required.'); return; }
    if (!subject.trim()) { setError('Subject is required.'); return; }
    if (!bodyHtml.trim() && !bodyText.trim()) {
      setError('At least one body (HTML or text) is required.');
      return;
    }

    const payload: CreateEmailTemplateInput = {
      key: key.trim(),
      name: name.trim(),
      description: description.trim() || undefined,
      subject: subject.trim(),
      bodyHtml: bodyHtml.trim(),
      bodyText: bodyText.trim(),
      fromName: fromName.trim() || undefined,
      replyTo: replyTo.trim() || undefined,
      variables: detectedVariables,
    };

    try {
      await onSave(payload);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  }

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* ── Left: Form ── */}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Key</label>
            <input
              type="text"
              className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm placeholder:text-gray-400"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="e.g. appointment-confirmation"
              disabled={!!initial || saving}
            />
            {initial && <p className="mt-1 text-xs text-gray-500">Key cannot be changed after creation.</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Status</label>
            <select
              className="w-full rounded border border-gray-300 px-3 py-2"
              value={initial?.status === 'inactive' ? 'inactive' : 'active'}
              disabled={saving}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
          <input
            type="text"
            className="w-full rounded border border-gray-300 px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Appointment Confirmation"
            disabled={saving}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
          <input
            type="text"
            className="w-full rounded border border-gray-300 px-3 py-2"
            value={description ?? ''}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional short description"
            disabled={saving}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Subject</label>
          <input
            type="text"
            className="w-full rounded border border-gray-300 px-3 py-2"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Your appointment is confirmed, {{client_name}}"
            disabled={saving}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Body — HTML</label>
          <textarea
            className="h-48 w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm"
            value={bodyHtml}
            onChange={(e) => setBodyHtml(e.target.value)}
            placeholder="<p>Hello {{client_name}}, …</p>"
            disabled={saving}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Body — Plain Text</label>
          <textarea
            className="h-32 w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm"
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            placeholder="Hello {{client_name}}, …"
            disabled={saving}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">From Name</label>
            <input
              type="text"
              className="w-full rounded border border-gray-300 px-3 py-2"
              value={fromName ?? ''}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="PraktiQU Clinic"
              disabled={saving}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Reply-To</label>
            <input
              type="email"
              className="w-full rounded border border-gray-300 px-3 py-2"
              value={replyTo ?? ''}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder="admin@clinic.example"
              disabled={saving}
            />
          </div>
        </div>

        {/* Detected variables */}
        <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Detected variables:{' '}
          <span className="font-mono">
            {detectedVariables.length > 0 ? detectedVariables.join(', ') : '—'}
          </span>
        </div>

        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handlePreview}
            disabled={saving}
            className="rounded border border-primary-600 px-4 py-2 text-sm text-primary-600 transition hover:bg-primary-50 disabled:opacity-50"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-primary-600 px-4 py-2 text-sm text-white transition hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </div>

      {/* ── Right: Preview + Sample values ── */}
      <div className="space-y-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Rendered preview</h3>
          {rendered ? (
            <div className="space-y-3">
              <div>
                <div className="text-xs font-medium text-gray-500">Subject</div>
                <div className="font-medium">{rendered.subject}</div>
              </div>
              {rendered.fromName && (
                <div>
                  <div className="text-xs font-medium text-gray-500">From</div>
                  <div className="text-sm">{rendered.fromName}</div>
                </div>
              )}
              {rendered.replyTo && (
                <div>
                  <div className="text-xs font-medium text-gray-500">Reply-To</div>
                  <div className="text-sm">{rendered.replyTo}</div>
                </div>
              )}
              <div>
                <div className="text-xs font-medium text-gray-500">Body (HTML)</div>
                <div
                  className="mt-1 rounded bg-gray-50 p-3 text-sm"
                  dangerouslySetInnerHTML={{ __html: rendered.bodyHtml }}
                />
              </div>
              {rendered.bodyText && (
                <div>
                  <div className="text-xs font-medium text-gray-500">Body (Text)</div>
                  <pre className="mt-1 whitespace-pre-wrap rounded bg-gray-50 p-3 text-xs font-mono text-gray-700">
                    {rendered.bodyText}
                  </pre>
                </div>
              )}
              {rendered.missingVariables.length > 0 && (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-xs font-medium text-amber-800">
                    Missing values for:{' '}
                    <span className="font-mono">{rendered.missingVariables.join(', ')}</span>
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400">Click Preview to render the template.</p>
          )}
        </div>

        {/* Sample variable values editor */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Sample values (key=value per line)
          </label>
          <textarea
            className="h-36 w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm"
            value={valuesText}
            onChange={(e) => setValuesText(e.target.value)}
            placeholder={"client_name=Ada Lovelace\nappointment_date=2026-06-15\nclinic_name=PraktiQU Clinic"}
            disabled={saving}
          />
          <p className="mt-1 text-xs text-gray-500">
            These values are used only for the preview pane.
          </p>
        </div>
      </div>
    </div>
  );
}