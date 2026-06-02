// src/app/(dashboard)/settings/email-templates/[id]/page.tsx
/**
 * Edit / view an existing email template.
 *
 * Auth: caller must be CLINIC_ADMIN / SUPER_ADMIN.
 *
 * Source: specs/018-email-templates/spec.md
 */

'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { TemplateEditor } from '@/components/email-template/editor';
import type { CreateEmailTemplateInput, EmailTemplateDTO } from '@/types/email-template';

export default function EditEmailTemplatePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [initial, setInitial] = useState<EmailTemplateDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/email-templates/${params.id}`)
      .then((r) => {
        if (!r.ok) throw new Error('Template not found');
        return r.json();
      })
      .then((data: EmailTemplateDTO) => {
        setInitial(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [params.id]);

  async function handleSave(data: CreateEmailTemplateInput) {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/email-templates/${params.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? 'Save failed');
      }
      router.push('/settings/email-templates');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-sm text-gray-500">Loading template…</div>
      </div>
    );
  }

  if (!initial) {
    return (
      <div className="p-6">
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Template not found.{' '}
          <button onClick={() => router.push('/settings/email-templates')} className="underline">
            Back to list
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <button
            onClick={() => router.push('/settings/email-templates')}
            className="mb-2 text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back
          </button>
          <h1 className="text-2xl font-semibold text-gray-900">Edit: {initial.name}</h1>
          {initial.description && (
            <p className="mt-1 text-sm text-gray-500">{initial.description}</p>
          )}
        </div>
      </div>
      <TemplateEditor initial={initial} onSave={handleSave} saving={saving} />
    </div>
  );
}