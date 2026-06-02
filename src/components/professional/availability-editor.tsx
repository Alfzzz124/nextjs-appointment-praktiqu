'use client';

/**
 * Availability editor — day-of-week grid with time range inputs.
 * US3: configure weekly availability
 *
 * T041: day-of-week grid and time range inputs
 */

import { useState } from 'react';
import { minutesToTime, timeToMinutes } from '@/lib/time-client';

const DAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

export interface AvailabilityWindow {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

interface AvailabilityEditorProps {
  initial?: AvailabilityWindow[];
  onSave: (windows: AvailabilityWindow[]) => Promise<void>;
  readOnly?: boolean;
}

export function AvailabilityEditor({ initial = [], onSave, readOnly = false }: AvailabilityEditorProps) {
  const [windows, setWindows] = useState<AvailabilityWindow[]>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addWindow(dayOfWeek: number) {
    const start = 9 * 60; // 09:00
    const end = 17 * 60; // 17:00
    setWindows([...windows, { dayOfWeek, startMinute: start, endMinute: end }]);
  }

  function removeWindow(index: number) {
    setWindows(windows.filter((_, i) => i !== index));
  }

  function updateWindow(index: number, field: 'start' | 'end', value: string) {
    const updated = [...windows];
    const mins = timeToMinutes(value);
    if (field === 'start') updated[index].startMinute = mins;
    else updated[index].endMinute = mins;
    setWindows(updated);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave(windows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save availability');
    } finally {
      setSaving(false);
    }
  }

  // Group windows by day
  const byDay = new Map<number, AvailabilityWindow[]>();
  for (const w of windows) {
    if (!byDay.has(w.dayOfWeek)) byDay.set(w.dayOfWeek, []);
    byDay.get(w.dayOfWeek)!.push(w);
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {DAYS.map((day) => {
          const dayWindows = byDay.get(day.value) ?? [];
          return (
            <div key={day.value} className="border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm text-gray-800">{day.label}</span>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => addWindow(day.value)}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    + Add window
                  </button>
                )}
              </div>

              {dayWindows.length === 0 && (
                <p className="text-xs text-gray-400 pl-2">No availability</p>
              )}

              {dayWindows.map((w, idx) => {
                const globalIdx = windows.findIndex(
                  (xw) => xw.dayOfWeek === w.dayOfWeek &&
                    xw.startMinute === w.startMinute &&
                    xw.endMinute === w.endMinute,
                  );
                return (
                  <div key={idx} className="flex items-center gap-2 mb-1 pl-2">
                    <span className="text-xs text-gray-500">{day.label}</span>
                    <input
                      type="time"
                      value={minutesToTime(w.startMinute)}
                      onChange={(e) => updateWindow(globalIdx, 'start', e.target.value)}
                      disabled={readOnly}
                      className="border rounded px-2 py-1 text-xs w-24"
                    />
                    <span className="text-xs text-gray-400">to</span>
                    <input
                      type="time"
                      value={minutesToTime(w.endMinute)}
                      onChange={(e) => updateWindow(globalIdx, 'end', e.target.value)}
                      disabled={readOnly}
                      className="border rounded px-2 py-1 text-xs w-24"
                    />
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => removeWindow(globalIdx)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {!readOnly && (
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Availability'}
        </button>
      )}
    </div>
  );
}