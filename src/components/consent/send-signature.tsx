// src/components/consent/send-signature.tsx
'use client';
import { useState } from 'react';

export function SendSignatureRequest({ onSend }: { onSend: (formId: string, clientId: string) => Promise<void> }) {
  const [formId, setFormId] = useState('');
  const [clientId, setClientId] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!formId || !clientId) return;
    setSending(true);
    try {
      await onSend(formId, clientId);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3 rounded border p-4">
      <h3 className="font-medium">Send for Signature</h3>
      <input className="w-full rounded border px-3 py-2" placeholder="Form ID" value={formId} onChange={(e) => setFormId(e.target.value)} />
      <input className="w-full rounded border px-3 py-2" placeholder="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} />
      <button type="button" onClick={handleSend} disabled={sending} className="rounded bg-primary-600 px-4 py-2 text-white">
        {sending ? 'Sending…' : 'Send request'}
      </button>
    </div>
  );
}

export default SendSignatureRequest;