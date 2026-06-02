/**
 * Professional sessions page — pending approval queue + calendar.
 *
 * T038: Professional sessions page with pending requests + calendar.
 * T091: Approve/reject functionality via PendingRequests component.
 */

'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PendingRequests } from '@/components/session/pending-requests';
import { SessionCalendar } from '@/components/session/session-calendar';
import type { SessionWithRelations, CalendarResponse } from '@/types/session';

const MOCK_PENDING: SessionWithRelations[] = [];

const MOCK_CALENDAR: CalendarResponse = {
  view: 'day',
  date: new Date().toISOString().slice(0, 10),
  sessions: [],
};

export default function ProfessionalSessionsPage() {
  const searchParams = useSearchParams();
  const [pending, setPending] = useState<SessionWithRelations[]>(MOCK_PENDING);
  const view = (searchParams.get('view') as 'day' | 'week' | 'month') ?? 'day';

  const refresh = () => {
    // TODO: re-fetch pending from /api/v1/sessions/pending
  };

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-8">
      <div className="mx-auto max-w-5xl space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">My Sessions</h1>
          <p className="mt-1 text-sm text-gray-500">Review pending requests and manage your schedule</p>
        </div>

        {/* Pending requests */}
        <section>
          <h2 className="mb-4 text-base font-semibold text-gray-700">Pending Requests</h2>
          <PendingRequests
            sessions={pending}
            onApprove={refresh}
            onReject={refresh}
          />
        </section>

        {/* Calendar */}
        <section>
          <h2 className="mb-4 text-base font-semibold text-gray-700">Calendar</h2>
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <SessionCalendar initialData={MOCK_CALENDAR} onSessionClick={() => {}} />
          </div>
        </section>
      </div>
    </main>
  );
}