// src/app/(dashboard)/intervention-plans/[id]/page.tsx
import { PrismaClient } from '@prisma/client';
import Link from 'next/link';

const prisma = new PrismaClient();

export default async function PlanDetailPage({ params }: { params: { id: string } }) {
  const plan = await prisma.interventionPlan.findUnique({
    where: { id: params.id },
    include: { items: { orderBy: { createdAt: 'asc' } } },
  });
  if (!plan) return <div className="p-6">Plan not found.</div>;

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{plan.clientId}</h1>
        <div className="flex gap-2">
          <Link href={`/intervention-plans/${plan.id}/print`} className="rounded border px-3 py-2">
            Print
          </Link>
        </div>
      </div>
      <div className="mb-2 text-sm text-gray-500">Status: {plan.status}</div>
      <div className="mb-6 text-sm text-gray-500">Created: {plan.createdAt.toLocaleString()}</div>
      <h2 className="mb-3 text-lg font-medium">Recommendations</h2>
      {plan.items.length === 0 ? (
        <p className="text-gray-500">No recommendations.</p>
      ) : (
        <ul className="space-y-3">
          {plan.items.map((item) => (
            <li key={item.id} className="rounded border p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">{item.description}</p>
                  {item.frequency && <p className="mt-1 text-sm text-gray-600">Frequency: {item.frequency}</p>}
                  {item.instructions && <p className="mt-1 text-sm text-gray-600">{item.instructions}</p>}
                </div>
                <span className={`rounded px-2 py-1 text-xs ${item.status === 'COMPLETED' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                  {item.status}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}