'use client';

/**
 * Off-day editor — date picker and reason field.
 * US3: manage off-day overrides
 *
 * T042: date picker and reason field
 */

import { useState } from 'react';

interface OffDay {
  id: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  createdAt: string;
}

interface OffDayEditorProps {
  professionalId: string;
  initial?: OffDay[];
  readOnly?: boolean;
  onAdd?: (startDate: string, endDate: string, reason: string | null) => Promise<void>;
  onRemove?: (id: string) => Promise<void>;
}

export function OffDayEditor({ professionalId, initial = [], readOnly = false, onAdd, onRemove }: OffDayEditorProps) {
  const [offDays, setOffDays] = useState<OffDay[]>(initial);
  const [adding, setAdding] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!startDate || !endDate) return;
    setSaving(true);
    setError(null);
    try {
      if (onAdd) {
        await onAdd(startDate, endDate, reason || null);
      }
      // Optimistic update
      setOffDays([
        ...offDays,
        {
          id: `temp-${Date.now()}`,
          startDate,
          endDate,
          reason: reason || null,
          createdAt: new Date().toISOString(),
        },
      ]);
      setAdding(false);
      setStartDate('');
      setEndDate('');
      setReason('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add off day');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: string) {
    if (onRemove) {
      await onRemove(id);
    }
    setOffDays(offDays.filter((od) => od.id !== id));
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('id-ID', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Existing off days */}
      {offDays.length > 0 && (
        <div className="space-y-2">
          {offDays.map((od) => (
            <div key={od.id} className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
              <div>
                <span className="text-sm font-medium text-gray-800">
                  {formatDate(od.startDate)}
                  {od.startDate !== od.endDate && ` — ${formatDate(od.endDate)}`}
                </span>
                {od.reason && <p className="text-xs text-gray-500 mt-0.5">{od.reason}</p>}
              </div>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => handleRemove(od.id)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      {!readOnly && !adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          + Add off day
        </button>
      )}

      {adding && (
        <div className="border rounded-lg p-4 space-y-3 bg-gray-50">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Reason (optional)</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Annual leave"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAdd}
              disabled={saving || !startDate || !endDate}
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Adding...' : 'Add'}
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setError(null); }}
              className="px-3 py-1.5 border border-gray-300 rounded text-xs hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}