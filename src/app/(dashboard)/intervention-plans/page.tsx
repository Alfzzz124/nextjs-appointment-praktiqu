// src/app/(dashboard)/intervention-plans/page.tsx
import { PrismaClient } from '@prisma/client';
import Link from 'next/link';

const prisma = new PrismaClient();

export default async function InterventionPlansPage() {
  const plans = await prisma.interventionPlan.findMany({
    include: { items: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return (
    <div className="p-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Intervention Plans</h1>
        <Link href="/intervention-plans/new" className="rounded bg-primary-600 px-3 py-2 text-white">
          New Plan
        </Link>
      </header>
      {plans.length === 0 ? (
        <p className="text-gray-500">No plans yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2">Client ID</th>
              <th className="text-left py-2">Status</th>
              <th className="text-left py-2">Items</th>
              <th className="text-left py-2">Created</th>
              <th className="text-left py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.id} className="border-b">
                <td className="py-2">{plan.clientId}</td>
                <td className="py-2">{plan.status}</td>
                <td className="py-2">{plan.items.length}</td>
                <td className="py-2">{plan.createdAt.toLocaleDateString()}</td>
                <td className="py-2">
                  <Link href={`/intervention-plans/${plan.id}`} className="text-primary-600 hover:underline">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}