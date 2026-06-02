/**
 * Professional dashboard — list & create Intervention Plans.
 *
 * US1 entry point. Renders the create-plan form above a list of recent plans
 * owned by the authenticated professional.
 *
 * Source of truth: specs/009-intervention-plan/spec.md
 */

import { PlanForm } from '@/components/intervention-plan/plan-form';

export const metadata = {
  title: 'Intervention Plans · PraktiQU',
};

export default function InterventionPlanListPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Intervention plans</h1>
        <p className="text-sm text-gray-600">
          Create recommendations for a client after a session. The plan is linked to the session and
          visible to the client immediately.
        </p>
      </header>

      <section aria-labelledby="new-plan-heading" className="rounded border p-4">
        <h2 id="new-plan-heading" className="mb-3 text-lg font-medium">
          New plan
        </h2>
        <PlanForm />
      </section>
    </main>
  );
}
