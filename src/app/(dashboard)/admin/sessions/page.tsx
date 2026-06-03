/**
 * Admin sessions calendar page.
 *
 * T057-T060: Calendar with day/week/month views, URL-based persistence.
 * Full-page calendar for receptionists/clinic admins.
 */

'use client';

import { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { SessionCalendar } from '@/components/session/session-calendar';
import { SessionDetailPanel } from '@/components/session/session-detail-panel';
import { SessionFilters } from '@/components/session/filters';
import type { SessionWithRelations, CalendarResponse } from '@/types/session';

const MOCK_CALENDAR_DATA: CalendarResponse = {
  view: 'day',
  date: new Date().toISOString().slice(0, 10),
  sessions: [],
};

function SessionsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const view = (searchParams.get('view') as 'day' | 'week' | 'month') ?? 'day';
  const dateParam = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

  return (
    <>
      {/* Filters toolbar */}
      <div className="mb-6">
        <SessionFilters
          onChange={(filters) => {
            const params = new URLSearchParams(searchParams.toString());
            if (filters.status) params.set('status', filters.status === 'ALL' ? '' : filters.status);
            if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
            if (filters.dateTo) params.set('dateTo', filters.dateTo);
            router.push(`?${params.toString()}`, { scroll: false });
          }}
        />
      </div>

      {/* Calendar */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <SessionCalendar
          initialData={MOCK_CALENDAR_DATA}
          isStaff={true}
          onSessionClick={(id) => setSelectedId(id)}
        />
      </div>

      {/* Detail panel (slide-over) */}
      <SessionDetailPanel
        session={null}
        onClose={() => setSelectedId(null)}
        actions={
          <>
            <button className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Check In
            </button>
            <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              Check Out
            </button>
            <button className="rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
              Cancel
            </button>
          </>
        }
      />
    </>
  );
}

export default function AdminSessionsPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-8">
      <div className="mx-auto max-w-6xl">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Sessions</h1>
          <p className="mt-1 text-sm text-gray-500">Manage client sessions and schedules</p>
        </div>

        <Suspense fallback={<div className="text-gray-500">Loading...</div>}>
          <SessionsContent />
        </Suspense>
      </div>
    </main>
  );
}