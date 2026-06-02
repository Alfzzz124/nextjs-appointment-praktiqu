// src/app/(dashboard)/settings/email-templates/new/page.tsx
/**
 * Create a new email template.
 *
 * Auth: caller must be CLINIC_ADMIN / SUPER_ADMIN.
 *
 * Source: specs/018-email-templates/spec.md
 */

'use client';
import { useRouter } from 'next/navigation';
import { TemplateEditor } from '@/components/email-template/editor';
import type { CreateEmailTemplateInput } from '@/types/email-template';

export default function NewEmailTemplatePage() {
  const router = useRouter();

  async function handleSave(data: CreateEmailTemplateInput) {
    const res = await fetch('/api/v1/email-templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message ?? 'Create failed');
    }
    router.push('/settings/email-templates');
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <button
          onClick={() => router.back()}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Back
        </button>
      </div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">New Email Template</h1>
      <TemplateEditor onSave={handleSave} />
    </div>
  );
}