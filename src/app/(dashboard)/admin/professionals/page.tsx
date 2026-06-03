/**
 * Admin professional list and create page.
 * US1: admin professional management
 *
 * T028: admin page mounting professional-list and create form
 */

import { Suspense } from 'react';
import { ProfessionalList } from '@/components/professional/professional-list';
import { ProfessionalForm } from '@/components/professional/professional-form';
import type { FormData } from '@/components/professional/professional-form';

export default function AdminProfessionalsPage() {
  async function handleCreate(data: FormData) {
    'use server';
    const res = await fetch('/api/v1/professionals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const json = await res.json();
      throw { fields: json.fields ?? { _form: [json.detail ?? 'Failed to create professional'] } };
    }
  }

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Professionals</h1>
        <p className="text-sm text-gray-500 mt-1">Manage psychologists, psychiatrists, and counselors</p>
      </div>

      {/* Create form */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Register New Professional</h2>
        <ProfessionalForm onSubmit={handleCreate} />
      </section>

      {/* List */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">All Professionals</h2>
        <Suspense fallback={<div className="text-gray-500">Loading...</div>}>
          <ProfessionalList />
        </Suspense>
      </section>
    </div>
  );
}