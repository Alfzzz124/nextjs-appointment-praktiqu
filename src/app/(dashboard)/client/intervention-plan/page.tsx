// src/app/(dashboard)/client/intervention-plan/page.tsx
// Client view of their own intervention plan.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default async function ClientInterventionPlanPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">My Intervention Plan</h1>
      <p className="mt-2 text-gray-600">
        View your recommendations and track your progress. (Auth-gated client view.)
      </p>
    </div>
  );
}