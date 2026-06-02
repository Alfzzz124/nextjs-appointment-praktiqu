/**
 * Session booking form for staff.
 *
 * T043: Staff booking form with client, professional, service, date, time selectors.
 * T105: T042 is handled in the service layer (auto BOOKED for staff).
 */

'use client';

import { useState } from 'react';
import type { CreateSessionBody } from '@/services/session/validation';

interface SessionFormProps {
  /** Pre-filled data if editing an existing session (not used for new sessions). */
  initialData?: Partial<CreateSessionBody>;
  /** Function to call on submit. Returns the created session or throws. */
  onSubmit?: (data: CreateSessionBody) => Promise<unknown>;
  /** Disable during submission. */
  loading?: boolean;
}

export function SessionForm({ initialData, onSubmit, loading = false }: SessionFormProps) {
  const [clientId, setClientId] = useState(initialData?.clientId ?? '');
  const [professionalId, setProfessionalId] = useState(initialData?.professionalId ?? '');
  const [serviceId, setServiceId] = useState(initialData?.serviceId ?? '');
  const [slotDate, setSlotDate] = useState(initialData?.slotDate ?? '');
  const [startTime, setStartTime] = useState(initialData?.startTime ?? '');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!clientId || !professionalId || !serviceId || !slotDate || !startTime) {
      setError('All fields are required');
      return;
    }
    try {
      await onSubmit?.({ clientId, professionalId, serviceId, slotDate, startTime });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="clientId">Client</label>
        <input
          id="clientId"
          type="text"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="Client ID or search..."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="professionalId">Professional</label>
        <input
          id="professionalId"
          type="text"
          value={professionalId}
          onChange={(e) => setProfessionalId(e.target.value)}
          placeholder="Professional ID or search..."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="serviceId">Service</label>
        <input
          id="serviceId"
          type="text"
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          placeholder="Service ID or search..."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="slotDate">Date</label>
          <input
            id="slotDate"
            type="date"
            value={slotDate}
            onChange={(e) => setSlotDate(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="startTime">Start Time</label>
          <input
            id="startTime"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            required
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Booking...' : 'Book Session'}
      </button>
    </form>
  );
}