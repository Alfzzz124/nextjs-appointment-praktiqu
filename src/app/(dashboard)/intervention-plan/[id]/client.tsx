'use client';

/**
 * InterventionPlan detail client component.
 *
 * Fetches and renders a single plan with its recommendation items.
 * Lets the professional add new items. Refreshes after mutations.
 *
 * Source of truth: specs/009-intervention-plan/spec.md
 */

import { useCallback, useEffect, useState } from 'react';
import { RecommendationForm } from '@/components/intervention-plan/recommendation-form';
import type { InterventionPlanWithItems } from '@/types/intervention-plan';

interface Props {
  planId: string;
}

function ItemRow({ item, readOnly = false }: { item: InterventionPlanWithItems['items'][number]; readOnly?: boolean }) {
  return (
    <li className="rounded border p-3">
      <p className="font-medium">{item.description}</p>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
        {item.frequency && <span>Frequency: {item.frequency}</span>}
        {item.durationDays && <span>Duration: {item.durationDays} days</span>}
        <span>Status: {item.status}</span>
      </div>
      {item.instructions && (
        <p className="mt-2 text-sm text-gray-700">{item.instructions}</p>
      )}
    </li>
  );
}

export function InterventionPlanClient({ planId }: Props) {
  const [plan, setPlan] = useState<InterventionPlanWithItems | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchPlan = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/intervention-plans/${planId}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string; title?: string };
        throw new Error(body.detail ?? body.title ?? `Failed to load plan (${res.status})`);
      }
      setPlan(await res.json());
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load plan');
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => { fetchPlan(); }, [fetchPlan]);

  if (loading) return <p>Loading…</p>;
  if (fetchError) return <p role="alert" className="text-red-600">{fetchError}</p>;
  if (!plan) return null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Intervention Plan</h1>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-gray-500">Session</dt><dd>{plan.sessionId}</dd>
          <dt className="text-gray-500">Client</dt><dd>{plan.clientId}</dd>
          <dt className="text-gray-500">Status</dt><dd>{plan.status}</dd>
          <dt className="text-gray-500">Created</dt><dd>{new Date(plan.createdAt).toLocaleDateString()}</dd>
        </dl>
      </header>

      <section aria-labelledby="add-item-heading">
        <h2 id="add-item-heading" className="mb-3 text-lg font-medium">Add recommendation</h2>
        <RecommendationForm planId={planId} onSuccess={fetchPlan} />
      </section>

      <section aria-labelledby="items-heading">
        <h2 id="items-heading" className="mb-3 text-lg font-medium">
          Recommendations ({plan.items.length})
        </h2>
        {plan.items.length === 0 ? (
          <p className="text-sm text-gray-500">No items yet. Add one above.</p>
        ) : (
          <ul className="space-y-2">{plan.items.map((item) => <ItemRow key={item.id} item={item} />)}</ul>
        )}
      </section>
    </div>
  );
}