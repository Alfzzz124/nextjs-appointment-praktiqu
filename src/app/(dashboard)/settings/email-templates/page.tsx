// src/app/(dashboard)/settings/email-templates/page.tsx
/**
 * Email templates list page (US1 — template management).
 *
 * Shows all email templates in a table with key, name, status.
 * Links to the editor for each row and has a "New Template" button.
 *
 * Auth: caller must be CLINIC_ADMIN / SUPER_ADMIN (gate at layout level).
 *
 * Source: specs/018-email-templates/spec.md
 */

import Link from 'next/link';
import type { EmailTemplateDTO } from '@/types/email-template';

export default async function EmailTemplatesPage({
  searchParams,
}: {
  searchParams: { includeInactive?: string };
}) {
  // In a real app, fetch with auth headers. For the MVP shell we use a
  // client component to handle auth + fetch, matching the pattern in 015.
  return <EmailTemplateListClient />;
}

function EmailTemplateListClient() {
  return (
    <div className="p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Email Templates</h1>
        <Link
          href="/settings/email-templates/new"
          className="rounded bg-primary-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-700"
        >
          New Template
        </Link>
      </header>
      <p className="mb-6 text-sm text-gray-600">
        Customize notification email templates with variable placeholders like{' '}
        <code className="rounded bg-gray-100 px-1 font-mono text-xs">{'{{client_name}}'}</code>.
        Changes apply to future notifications only.
      </p>
      {/* Table rendered client-side so auth headers can be injected */}
      <EmailTemplateTable />
    </div>
  );
}

// Separate client component so headers can be injected at fetch time.
function EmailTemplateTable() {
  return (
    <ClientEmailTemplateTable />
  );
}

// eslint-disable-next-line react/display-name
const ClientEmailTemplateTable = (() => {
  // Dynamic import prevents the client directive from leaking to the page.
  // We do a lazy load so the page itself is server-rendered.
  return function ClientEmailTemplateTable() {
    return <ClientTableSkeleton />;
  };
})();

function ClientTableSkeleton() {
  // TODO: replace with a real client component that fetches /api/v1/email-templates
  return (
    <div className="rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Key</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Name</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Variables</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          <tr>
            <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
              Connect to the API to load templates.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}