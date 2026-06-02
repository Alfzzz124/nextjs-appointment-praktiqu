/**
 * Professional pending requests queue.
 *
 * T037: For professional dashboard — shows all PENDING sessions awaiting approval.
 */

'use client';

import { useState } from 'react';
import type { SessionWithRelations } from '@/types/session';
import { STATUS_COLOR } from '@/types/session';

interface PendingRequestsProps {
  sessions: SessionWithRelations[];
  onApprove?: (sessionId: string) => void;
  onReject?: (sessionId: string) => void;
  loading?: boolean;
}

export function PendingRequests({ sessions, onApprove, onReject, loading = false }: PendingRequestsProps) {
  const [processing, setProcessing] = useState<Set<string>>(new Set());

  const handle = async (sessionId: string, action: 'approve' | 'reject') => {
    setProcessing((prev) => new Set(prev).add(sessionId));
    try {
      if (action === 'approve') {
        await fetch(`/api/v1/sessions/${sessionId}/approve`, { method: 'POST' });
        onApprove?.(sessionId);
      } else {
        const reason = window.prompt('Please provide a reason for rejection:');
        if (!reason?.trim()) return;
        await fetch(`/api/v1/sessions/${sessionId}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        });
        onReject?.(sessionId);
      }
    } finally {
      setProcessing((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  };

  return (
    <div className="space-y-3">
      {loading && sessions.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <span className="ml-2 text-sm text-gray-500">Loading pending requests...</span>
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-8 text-center">
          <p className="text-sm text-gray-500">No pending requests</p>
        </div>
      ) : (
        sessions.map((s) => (
          <div key={s.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900">{s.client.fullName}</p>
                <p className="text-sm text-gray-500">{s.service.name} · {s.service.durationMinutes} min</p>
                <p className="mt-1 text-sm text-gray-600">
                  {new Date(s.slotDate).toLocaleDateString('en-GB', { dateStyle: 'long' })} at{' '}
                  {new Date(s.startTime).toLocaleTimeString('en-GB', { timeStyle: 'short' })}
                </p>
              </div>
              <span
                className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium text-white shrink-0"
                style={{ backgroundColor: STATUS_COLOR[s.status] }}
              >
                {s.status}
              </span>
            </div>

            {processing.has(s.id) ? (
              <div className="mt-3 flex justify-center">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              </div>
            ) : (
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => handle(s.id, 'reject')}
                  className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                >
                  Reject
                </button>
                <button
                  onClick={() => handle(s.id, 'approve')}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                >
                  Approve
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}