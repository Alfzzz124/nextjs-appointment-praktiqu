/**
 * Session filters component — status chips, date range, professional/client/service selects.
 *
 * T065: Filters with status chips, date range picker, professional select, client select, service select.
 * T066: URL-based filter persistence (handled in the page, not here).
 */

'use client';

import type { SessionStatus } from '@prisma/client';

const STATUS_OPTIONS: { value: SessionStatus | 'ALL'; label: string; color: string }[] = [
  { value: 'ALL', label: 'All', color: '#6b7280' },
  { value: 'PENDING', label: 'Pending', color: '#eab308' },
  { value: 'BOOKED', label: 'Booked', color: '#22c55e' },
  { value: 'CHECK_IN', label: 'Checked In', color: '#3b82f6' },
  { value: 'CHECK_OUT', label: 'Checked Out', color: '#8b5cf6' },
  { value: 'COMPLETED', label: 'Completed', color: '#6b7280' },
  { value: 'REJECTED', label: 'Rejected', color: '#ef4444' },
  { value: 'CANCELLED', label: 'Cancelled', color: '#6b7280' },
];

interface SessionFiltersProps {
  status?: SessionStatus | 'ALL';
  dateFrom?: string;
  dateTo?: string;
  professionalId?: string;
  clientId?: string;
  onChange?: (filters: {
    status?: SessionStatus | 'ALL';
    dateFrom?: string;
    dateTo?: string;
    professionalId?: string;
    clientId?: string;
  }) => void;
}

export function SessionFilters({ status, dateFrom, dateTo, professionalId, clientId, onChange }: SessionFiltersProps) {
  const update = (partial: Parameters<NonNullable<typeof onChange>>[0]) => {
    onChange?.({
      ...(status !== undefined ? { status } : {}),
      ...(dateFrom !== undefined ? { dateFrom } : {}),
      ...(dateTo !== undefined ? { dateTo } : {}),
      ...(professionalId !== undefined ? { professionalId } : {}),
      ...(clientId !== undefined ? { clientId } : {}),
      ...partial,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* Status chips */}
      <div className="flex flex-wrap gap-1.5">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => update({ status: opt.value })}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all ${
              status === opt.value || (!status && opt.value === 'ALL')
                ? 'ring-2 ring-offset-1'
                : 'opacity-70 hover:opacity-100'
            }`}
            style={{
              backgroundColor: status === opt.value || (!status && opt.value === 'ALL')
                ? opt.color
                : `${opt.color}20`,
              color: status === opt.value || (!status && opt.value === 'ALL') ? '#fff' : opt.color,
              ringColor: opt.color,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Date range */}
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-gray-500">From</label>
        <input
          type="date"
          value={dateFrom ?? ''}
          onChange={(e) => update({ dateFrom: e.target.value })}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
        <label className="text-xs font-medium text-gray-500">To</label>
        <input
          type="date"
          value={dateTo ?? ''}
          onChange={(e) => update({ dateTo: e.target.value })}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Professional filter */}
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-gray-500">Professional</label>
        <input
          type="text"
          value={professionalId ?? ''}
          placeholder="Filter by professional..."
          onChange={(e) => update({ professionalId: e.target.value })}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Client filter */}
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-gray-500">Client</label>
        <input
          type="text"
          value={clientId ?? ''}
          placeholder="Filter by client..."
          onChange={(e) => update({ clientId: e.target.value })}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>
    </div>
  );
}