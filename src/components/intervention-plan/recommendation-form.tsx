'use client';

/**
 * Recommendation item add form.
 *
 * Professional adds an activity / exercise to an existing plan.
 * Source of truth: specs/009-intervention-plan/spec.md (US2)
 */

import { useState, type FormEvent } from 'react';
import { AddItemInput } from '@/types/intervention-plan';

export interface RecommendationFormProps {
  planId: string;
  onItemAdded?: (itemId: string) => void;
  apiPath?: string;
  onSuccess?: () => void;
}

export function RecommendationForm({
  planId,
  onItemAdded,
  apiPath = `/api/v1/intervention-plans/${planId}/items`,
  onSuccess,
}: RecommendationFormProps) {
  const [description, setDescription] = useState('');
  const [frequency, setFrequency] = useState('');
  const [durationDays, setDurationDays] = useState('');
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const parsed = AddItemInput.safeParse({
      description,
      frequency: frequency || undefined,
      durationDays: durationDays ? Number(durationDays) : undefined,
      instructions: instructions || undefined,
    });
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
      const item = (await res.json()) as { id: string };
      setDescription('');
      setFrequency('');
      setDurationDays('');
      setInstructions('');
      onItemAdded?.(item.id);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add item');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Add recommendation item" className="space-y-3">
      <div>
        <label htmlFor="ri-description" className="block text-sm font-medium">
          Description <span className="text-red-500">*</span>
        </label>
        <textarea
          id="ri-description"
          required
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded border px-3 py-2"
          placeholder="e.g. Practice mindfulness meditation"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="ri-frequency" className="block text-sm font-medium">
            Frequency
          </label>
          <input
            id="ri-frequency"
            type="text"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
            className="w-full rounded border px-3 py-2"
            placeholder="e.g. Daily"
          />
        </div>
        <div>
          <label htmlFor="ri-duration" className="block text-sm font-medium">
            Duration (days)
          </label>
          <input
            id="ri-duration"
            type="number"
            min={1}
            max={3650}
            value={durationDays}
            onChange={(e) => setDurationDays(e.target.value)}
            className="w-full rounded border px-3 py-2"
            placeholder="e.g. 30"
          />
        </div>
      </div>

      <div>
        <label htmlFor="ri-instructions" className="block text-sm font-medium">
          Instructions
        </label>
        <textarea
          id="ri-instructions"
          rows={2}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className="w-full rounded border px-3 py-2"
          placeholder="Additional guidance or notes"
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
        {submitting ? 'Adding…' : 'Add item'}
      </button>
    </form>
  );
}