'use client';

/**
 * Holiday list + add/remove form for a Practice.
 *
 * Fetches existing holidays, lets users add new ones (POST) and remove
 * existing ones (DELETE /:id/holidays/:holidayId).
 */
import { useCallback, useEffect, useState } from 'react';
import type { HolidayDTO } from '@/types/practice';

interface HolidaysProps {
  practiceId: string;
  onError?: (message: string) => void;
}

/** Convert a YYYY-MM-DD string to a human-readable label */
function formatDate(d: string) {
  const [year, month, day] = d.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function Holidays({ practiceId, onError }: HolidaysProps) {
  const [holidays, setHolidays] = useState<HolidayDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);

  // Add form state
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const fetchHolidays = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/practices/${practiceId}/holidays`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { data } = await res.json() as { data: HolidayDTO[] };
      setHolidays(data ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load holidays';
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  }, [practiceId, onError]);

  useEffect(() => { void fetchHolidays(); }, [fetchHolidays]);

  async function handleRemove(holidayId: string) {
    setRemoving((prev) => new Set(prev).add(holidayId));
    try {
      const res = await fetch(`/api/v1/practices/${practiceId}/holidays/${holidayId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { detail?: string }).detail ?? `HTTP ${res.status}`);
      }
      setHolidays((prev) => prev.filter((h) => h.id !== holidayId));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Remove failed';
      onError?.(msg);
    } finally {
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(holidayId);
        return next;
      });
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !startDate || !endDate) return;
    if (endDate < startDate) {
      setAddError('End date must be on or after the start date.');
      return;
    }
    setAddError('');
    setAdding(true);
    try {
      const res = await fetch(`/api/v1/practices/${practiceId}/holidays`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), startDate, endDate, isAllDay: true }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const issues = (json as { issues?: Array<{ message: string }> }).issues;
        const msg = issues?.[0]?.message ?? (json as { detail?: string }).detail ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const { data } = await res.json() as { data: HolidayDTO };
      setHolidays((prev) => [...prev, data].sort((a, b) => a.startDate.localeCompare(b.startDate)));
      setTitle('');
      setStartDate('');
      setEndDate('');
      setAddOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Add failed';
      setAddError(msg);
    } finally {
      setAdding(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-500">Loading holidays…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Holidays</h2>
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          {addOpen ? 'Cancel' : '+ Add Holiday'}
        </button>
      </div>

      {/* Add form */}
      {addOpen && (
        <form
          onSubmit={handleAdd}
          className="rounded-md border border-gray-200 bg-gray-50 p-4 space-y-3"
          noValidate
        >
          <div>
            <label htmlFor="holiday-title" className="block text-sm font-medium text-gray-700">
              Holiday Name *
            </label>
            <input
              id="holiday-title"
              type="text"
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. National Holiday"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="start-date" className="block text-sm font-medium text-gray-700">
                Start Date *
              </label>
              <input
                id="start-date"
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
              />
            </div>
            <div>
              <label htmlFor="end-date" className="block text-sm font-medium text-gray-700">
                End Date *
              </label>
              <input
                id="end-date"
                type="date"
                required
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
              />
            </div>
          </div>
          {addError && (
            <p className="text-sm text-red-600">{addError}</p>
          )}
          <button
            type="submit"
            disabled={adding || !title || !startDate || !endDate}
            className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {adding ? 'Adding…' : 'Add Holiday'}
          </button>
        </form>
      )}

      {/* Holiday list */}
      {holidays.length === 0 && !addOpen ? (
        <p className="text-sm text-gray-500">No holidays configured for this practice.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <span className="font-medium text-gray-900">{h.title}</span>
                <span className="ml-2 text-sm text-gray-500">
                  {h.startDate === h.endDate
                    ? formatDate(h.startDate)
                    : `${formatDate(h.startDate)} – ${formatDate(h.endDate)}`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(h.id)}
                disabled={removing.has(h.id)}
                className="inline-flex items-center rounded-md border border-red-300 bg-white px-2.5 py-1.5 text-sm font-medium text-red-700 shadow-sm hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50"
              >
                {removing.has(h.id) ? 'Removing…' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}