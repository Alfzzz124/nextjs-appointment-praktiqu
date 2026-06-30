/**
 * Consent forms management page.
 * US7: informed consent management
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';

interface ConsentForm {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  signaturesCount: number;
}

export default function ConsentFormsPage() {
  const [forms] = useState<ConsentForm[]>([]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Consent Forms</h1>
          <p className="text-sm text-gray-500 mt-1">Manage informed consent documents</p>
        </div>
        <Link
          href="/consent-forms/new"
          className="px-4 py-2 bg-primary-700 text-white rounded-lg text-sm font-medium hover:bg-primary-800 transition-colors"
        >
          + Create Form
        </Link>
      </div>

      {/* Forms grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {forms.length === 0 ? (
          <div className="col-span-full bg-white rounded-xl border border-gray-200 p-8 text-center">
            <div className="text-4xl mb-3">📝</div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">No consent forms yet</h3>
            <p className="text-sm text-gray-500 mb-4">Create your first consent form to get started</p>
            <Link
              href="/consent-forms/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-700 text-white rounded-lg text-sm font-medium hover:bg-primary-800 transition-colors"
            >
              + Create Form
            </Link>
          </div>
        ) : (
          forms.map((form) => (
            <div key={form.id} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">{form.name}</h3>
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{form.description}</p>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  {form.signaturesCount} signatures
                </span>
                <Link
                  href={`/consent-forms/${form.id}`}
                  className="text-sm text-primary-700 hover:underline"
                >
                  View →
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
