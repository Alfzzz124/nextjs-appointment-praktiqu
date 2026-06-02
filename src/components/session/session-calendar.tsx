/**
 * Session calendar — day/week/month views.
 *
 * T057: Implement calendar endpoint with views (already done server-side).
 * T058: Calendar component with day/week/month view switching.
 * T060: URL-based view persistence (view=day|week|month, date=YYYY-MM-DD).
 */

import { useSearchParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CalendarResponse, CalendarView } from '@/types/session';
import { STATUS_COLOR } from '@/types/session';

const VIEW_LABELS: Record<CalendarView, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
};

interface SessionCalendarProps {
  /** Initial data from server-side fetch; updated on view/date change. */
  initialData?: CalendarResponse;
  /** When true, renders the staff full-width calendar (receptionist/admin). */
  isStaff?: boolean;
  /** Callback when a session row is clicked. */
  onSessionClick?: (sessionId: string) => void;
}

export function SessionCalendar({ initialData, isStaff = false, onSessionClick }: SessionCalendarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view, setView] = useState<CalendarView>(
    (searchParams.get('view') as CalendarView) ?? 'day',
  );
  const [date, setDate] = useState(searchParams.get('date') ?? '');

  const handleViewChange = (v: CalendarView) => {
    setView(v);
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', v);
    router.push(`?${params.toString()}`, { scroll: false });
  };

  const handleDateChange = (d: string) => {
    setDate(d);
    const params = new URLSearchParams(searchParams.toString());
    params.set('date', d);
    router.push(`?${params.toString()}`, { scroll: false });
  };

  const sessions = initialData?.sessions ?? [];

  return (
    <div className={`flex flex-col ${isStaff ? '' : 'max-w-4xl'}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => handleDateChange(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-0.5">
          {(['day', 'week', 'month'] as CalendarView[]).map((v) => (
            <button
              key={v}
              onClick={() => handleViewChange(v)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                view === v
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
      </div>

      {/* Session list */}
      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 py-16 text-center">
          <svg className="h-10 w-10 text-gray-200 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
          </svg>
          <p className="text-gray-500">No sessions for this period</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => onSessionClick?.(s.id)}
              className="w-full flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 text-left transition-shadow hover:shadow-md hover:border-blue-200"
            >
              {/* Time */}
              <div className="min-w-[80px] text-sm font-medium text-gray-700">
                <span>{s.startTime}</span>
                <span className="text-gray-400">–{s.endTime}</span>
              </div>

              {/* Color bar */}
              <div
                className="h-10 w-1 rounded-full"
                style={{ backgroundColor: STATUS_COLOR[s.status] }}
                aria-hidden="true"
              />

              {/* Details */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{s.client}</p>
                <p className="text-xs text-gray-500 truncate">{s.service}</p>
              </div>

              {/* Professional */}
              {isStaff && (
                <p className="text-xs text-gray-500 shrink-0">{s.professionalName}</p>
              )}

              {/* Status */}
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white shrink-0"
                style={{ backgroundColor: STATUS_COLOR[s.status] }}
              >
                {s.status.replace('_', ' ')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}