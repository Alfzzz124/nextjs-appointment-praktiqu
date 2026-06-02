/**
 * Professional dashboard — plan detail with recommendation items.
 *
 * Renders the plan plus its items, and lets the professional add new items.
 * Source of truth: specs/009-intervention-plan/spec.md (US1 + US2)
 */

import { notFound } from 'next/navigation';
import { InterventionPlanClient } from './client';

interface Props {
  params: { id: string };
}

export default function InterventionPlanDetailPage({ params }: Props) {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <InterventionPlanClient planId={params.id} />
    </main>
  );
}

export async function generateMetadata({ params }: Props) {
  return { title: `Plan ${params.id} · PraktiQU` };
}