/**
 * Admin professional edit/detail page.
 * T028: admin page for editing professionals
 */

import { notFound } from 'next/navigation';
import { ProfessionalForm } from '@/components/professional/professional-form';
import { StatusBadge } from '@/components/professional/status-badge';
import type { FormData } from '@/components/professional/professional-form';
import type { ProfessionalStatus } from '@prisma/client';

const PROFESSIONAL_TYPE_LABELS: Record<string, string> = {
  PSIKOLOG_KLINIS: 'Psikolog Klinis',
  PSIKOLOG_ANAK: 'Psikolog Anak',
  PSIKIATER: 'Psikiater',
  KONSELOR: 'Konselor',
};

interface PageProps {
  params: { id: string };
}

async function getProfessional(id: string) {
  // In production, call the service directly
  // For now this is a skeleton — the page is a client component wrapper
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/v1/professionals/${id}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function AdminProfessionalDetailPage({ params }: PageProps) {
  const professional = await getProfessional(params.id);

  if (!professional) {
    notFound();
  }

  async function handleUpdate(data: FormData) {
    'use server';
    const res = await fetch(`/api/v1/professionals/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const json = await res.json();
      throw { fields: json.fields ?? { _form: [json.detail ?? 'Failed to update professional'] } };
    }
  }

  async function handleStatusChange(newStatus: ProfessionalStatus) {
    'use server';
    const res = await fetch(`/api/v1/professionals/${params.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) {
      const json = await res.json();
      throw { fields: { _form: [json.detail ?? 'Failed to change status'] } };
    }
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{professional.fullName}</h1>
          <p className="text-sm text-gray-500 mt-1">{professional.email}</p>
        </div>
        <StatusBadge status={professional.status} />
      </div>

      <div className="bg-white border rounded-lg p-6 space-y-2 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-gray-500">Type</span>
            <p className="font-medium">{PROFESSIONAL_TYPE_LABELS[professional.professionalType] ?? professional.professionalType}</p>
          </div>
          <div>
            <span className="text-gray-500">Registration</span>
            <p className="font-mono">{professional.registrationNumber}</p>
          </div>
          <div>
            <span className="text-gray-500">Practice</span>
            <p className="font-medium">{professional.practice?.name ?? '—'}</p>
          </div>
          <div>
            <span className="text-gray-500">Created</span>
            <p>{new Date(professional.createdAt).toLocaleDateString('id-ID')}</p>
          </div>
        </div>
      </div>

      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Edit Profile</h2>
        <ProfessionalForm
          initial={{
            fullName: professional.fullName,
            email: professional.email,
            professionalType: professional.professionalType,
            registrationNumber: professional.registrationNumber,
            biography: professional.biography,
            specialties: professional.specialties ?? [],
            contactInfo: professional.contactInfo ?? undefined,
            practiceId: professional.practiceId ?? undefined,
          }}
          onSubmit={handleUpdate}
        />
      </section>

      {/* Status change actions */}
      {professional.status !== 'ACTIVE' && (
        <section className="border-t pt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Actions</h3>
          <div className="flex gap-2">
            {professional.status !== 'ACTIVE' && (
              <form action={handleStatusChange as unknown as (formData: FormData) => Promise<void>}>
                <button
                  type="submit"
                  formAction={async () => {
                    'use server';
                    await handleStatusChange('ACTIVE' as ProfessionalStatus);
                  }}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
                >
                  Activate
                </button>
              </form>
            )}
          </div>
        </section>
      )}
    </div>
  );
}