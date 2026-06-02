// src/app/(dashboard)/intervention-plans/[id]/print/page.tsx
import { PrismaClient } from '@prisma/client';
import { buildHtml } from '@/services/intervention-plan-print/print';

const prisma = new PrismaClient();

async function loadPlan(id: string) {
  // Real schema may not include InterventionPlan yet; gracefully fall back to stub.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model: any = (prisma as any).interventionPlan;
  if (!model) {
    return {
      id,
      title: 'Sample intervention plan',
      description: 'Demo plan used for print preview.',
      startDate: new Date(),
      endDate: undefined,
      client: { user: { displayName: 'Demo Client' } },
      professional: { user: { displayName: 'Dr. Demo' } },
      clinic: { name: 'Demo Clinic' },
      recommendations: [
        { id: 'r1', title: 'Daily stretching', description: '15 minutes', frequency: 'daily', isCompleted: false, completedAt: null },
        { id: 'r2', title: 'Weekly reflection', frequency: 'weekly', isCompleted: true, completedAt: new Date() },
      ],
    };
  }
  return model.findUnique({
    where: { id },
    include: {
      client: { include: { user: true } },
      professional: { include: { user: true } },
      clinic: true,
      recommendations: true,
    },
  });
}

export default async function PrintPage({ params }: { params: { id: string } }) {
  const plan = await loadPlan(params.id);
  if (!plan) {
    return <div>Plan not found.</div>;
  }
  const html = buildHtml(
    {
      id: plan.id,
      clientName: plan.client?.user?.displayName ?? 'Client',
      clientId: plan.clientId ?? '',
      professionalName: plan.professional?.user?.displayName ?? 'Professional',
      clinicName: plan.clinic?.name,
      title: plan.title,
      description: plan.description,
      startDate: plan.startDate,
      endDate: plan.endDate,
      recommendations: (plan.recommendations ?? []).map((r: any) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        frequency: r.frequency,
        completed: !!r.isCompleted,
        completedAt: r.completedAt,
      })),
    },
    { primaryColor: '#0ea5e9' },
  );
  return (
    <div>
      <div className="no-print fixed right-4 top-4 flex gap-2">
        <button
          onClick={() => typeof window !== 'undefined' && window.print()}
          className="rounded bg-primary-600 px-3 py-2 text-white"
        >
          Print
        </button>
      </div>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
