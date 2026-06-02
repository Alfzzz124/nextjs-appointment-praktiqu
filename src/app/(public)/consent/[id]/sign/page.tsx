// src/app/(public)/consent/[id]/sign/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

export default function SignConsentPage() {
  const params = useParams<{ id: string }>();
  const [form, setForm] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signatureText, setSignatureText] = useState('');

  useEffect(() => {
    fetch(`/api/v1/consent-forms/${params.id}`)
      .then((r) => r.json())
      .then((data) => { setForm(data); setLoading(false); });
  }, [params.id]);

  async function handleSign(status: 'SIGNED' | 'DECLINED') {
    setSaving(true);
    const clientId = 'guest'; // In real flow, from auth context
    await fetch('/api/v1/consent-signatures', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ formId: params.id, clientId, status, signatureText: status === 'SIGNED' ? signatureText : undefined }),
    });
    setSaving(false);
    alert(status === 'SIGNED' ? 'Consent signed successfully.' : 'Consent declined.');
  }

  if (loading) return <div className="p-8 text-center">Loading…</div>;
  if (!form) return <div className="p-8 text-center">Form not found.</div>;

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-4 text-2xl font-semibold">{form.name}</h1>
      <div className="prose mb-8" dangerouslySetInnerHTML={{ __html: form.content }} />
      {form.status !== 'SIGNED' && (
        <div className="space-y-4 rounded border p-4">
          <h2 className="font-medium">Sign Consent</h2>
          <input
            className="w-full rounded border px-3 py-2"
            placeholder="Type your full name"
            value={signatureText}
            onChange={(e) => setSignatureText(e.target.value)}
          />
          <div className="flex gap-3">
            <button
              onClick={() => handleSign('SIGNED')}
              disabled={saving || !signatureText}
              className="rounded bg-green-600 px-4 py-2 text-white disabled:opacity-50"
            >
              I Sign
            </button>
            <button
              onClick={() => handleSign('DECLINED')}
              disabled={saving}
              className="rounded border border-red-600 px-4 py-2 text-red-600"
            >
              I Decline
            </button>
          </div>
        </div>
      )}
      {form.status === 'SIGNED' && <p className="text-green-600">✓ Consent already signed.</p>}
    </div>
  );
}