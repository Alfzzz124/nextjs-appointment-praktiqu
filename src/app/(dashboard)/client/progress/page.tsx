// src/app/(dashboard)/client/progress/page.tsx
import { PrismaClient } from '@prisma/client';
import { ProgressService } from '@/services/progress/service';

const prisma = new PrismaClient();
const svc = new ProgressService(prisma);

export default async function ClientProgressPage({ params }: { params: { clientId?: string } }) {
  const clientId = params?.clientId ?? '';
  const timeline = await svc.getClientTimeline(clientId);
  const goals = await svc.getGoals(clientId);

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-semibold">Client Progress</h1>
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-medium">Timeline</h2>
        {timeline.length === 0 ? (
          <p className="text-gray-500">No entries yet.</p>
        ) : (
          <ul className="space-y-4">
            {timeline.map((entry) => (
              <li key={entry.id} className="rounded border p-4">
                <div className="flex items-center justify-between">
                  <span className="rounded bg-primary-100 px-2 py-1 text-xs font-medium">{entry.type}</span>
                  <span className="text-sm text-gray-500">{entry.occurredAt.toLocaleDateString()}</span>
                </div>
                <p className="mt-2 font-medium">{entry.title}</p>
                {entry.description && <p className="mt-1 text-sm text-gray-600">{entry.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-3 text-lg font-medium">Goals</h2>
        {goals.length === 0 ? (
          <p className="text-gray-500">No goals set.</p>
        ) : (
          <ul className="space-y-3">
            {goals.map((goal) => (
              <li key={goal.id} className="rounded border p-4">
                <div className="flex items-center justify-between">
                  <span className={`font-medium ${goal.isAchieved ? 'text-green-600' : ''}`}>{goal.title}</span>
                  <span className={`rounded px-2 py-1 text-xs ${goal.isAchieved ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                    {goal.isAchieved ? 'Achieved' : 'In progress'}
                  </span>
                </div>
                {goal.description && <p className="mt-1 text-sm text-gray-600">{goal.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}