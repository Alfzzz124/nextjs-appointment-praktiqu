'use client';

/**
 * Plan creation form.
 *
 * Used by professionals to create an Intervention Plan for a client after
 * a session. The component is purely presentational: validation is performed
 * client-side via the same Zod schema the API uses, then the form posts to
 * `/api/v1/intervention-plans`.
 *
 * Source of truth: specs/009-intervention-plan/spec.md (US1)
 */

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CreatePlanInput } from '@/types/intervention-plan';

export interface PlanFormProps {
  /** Pre-selected session id (typically from a "create plan" deep-link). */
  sessionId?: string;
  /** Pre-selected client id. */
  clientId?: string;
  /** API path override for tests. */
  apiPath?: string;
  /** Optional callback fired with the new plan id on success. */
  onCreated?: (planId: string) => void;
}

export function PlanForm({ sessionId = '', clientId = '', apiPath = '/api/v1/intervention-plans', onCreated }: PlanFormProps) {
  const router = useRouter();
  const [sess, setSess] = useState(sessionId);
  const [client, setClient] = useState(clientId);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const parsed = CreatePlanInput.safeParse({ sessionId: sess, clientId: client });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(apiPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string; title?: string };
        throw new Error(body.detail ?? body.title ?? `Request failed (${res.status})`);
      }
      const plan = (await res.json()) as { id: string };
      onCreated?.(plan.id);
      router.push(`/intervention-plan/${plan.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create plan');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Create intervention plan" className="space-y-4">
      <div>
        <label htmlFor="ip-session-id" className="block text-sm font-medium">
          Session ID
        </label>
        <input
          id="ip-session-id"
          name="sessionId"
          type="text"
          required
          value={sess}
          onChange={(e) => setSess(e.target.value)}
          className="w-full rounded border px-3 py-2"
        />
      </div>

      <div>
        <label htmlFor="ip-client-id" className="block text-sm font-medium">
          Client ID
        </label>
        <input
          id="ip-client-id"
          name="clientId"
          type="text"
          required
          value={client}
          onChange={(e) => setClient(e.target.value)}
          className="w-full rounded border px-3 py-2"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {submitting ? 'Creating…' : 'Create plan'}
      </button>
    </form>
  );
}
