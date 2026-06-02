/**
 * Session detail panel — slide-over or modal showing all session attributes.
 *
 * T062: Display client name/contact, professional name, service/duration,
 *       slot times, status with timestamp, notes link.
 * T063: Empty state when no session selected.
 * T064: Integrated into calendar page as slide-over.
 */

import type { SessionWithRelations } from '@/types/session';
import { StatusBadge } from './status-badge';

interface SessionDetailPanelProps {
  session: SessionWithRelations | null;
  onClose?: () => void;
  /** Action buttons to render in the footer (check-in, check-out, cancel, etc.) */
  actions?: React.ReactNode;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    dateStyle: 'long',
  });
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm font-medium text-gray-500">{label}</span>
      <span className="text-sm text-gray-900">{children}</span>
    </div>
  );
}

export function SessionDetailPanel({ session, onClose, actions }: SessionDetailPanelProps) {
  return (
    <>
      {/* Backdrop */}
      {session && (
        <div
          className="fixed inset-0 bg-black/20 z-40"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Slide-over panel */}
      <aside
        className={`
          fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-xl z-50
          flex flex-col
          transition-transform duration-300 ease-in-out
          ${session ? 'translate-x-0' : 'translate-x-full'}
        `}
        aria-label="Session details"
      >
        {session ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Session Details</h2>
                <p className="mt-0.5 text-sm text-gray-500">{session.id}</p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={session.status} />
                <button
                  onClick={onClose}
                  className="rounded-md p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                  aria-label="Close panel"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 5L5 15M5 5l10 10" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {/* Client */}
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Client</h3>
              <div className="mb-4 rounded-lg bg-gray-50 p-3">
                <p className="font-medium text-gray-900">{session.client.fullName}</p>
                {session.client.uniqueClientId && (
                  <p className="text-xs text-gray-500">{session.client.uniqueClientId}</p>
                )}
                {session.client.mobileNumber && (
                  <p className="text-sm text-gray-600">{session.client.mobileNumber}</p>
                )}
                {session.client.email && (
                  <p className="text-sm text-gray-600">{session.client.email}</p>
                )}
              </div>

              {/* Professional */}
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Professional</h3>
              <div className="mb-4 rounded-lg bg-gray-50 p-3">
                <p className="font-medium text-gray-900">{session.professional.fullName}</p>
                {session.professional.email && (
                  <p className="text-sm text-gray-600">{session.professional.email}</p>
                )}
              </div>

              {/* Session details */}
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Session</h3>
              <div className="mb-4">
                <Section label="Service">{session.service.name}</Section>
                <Section label="Duration">{session.service.durationMinutes} min</Section>
                <Section label="Date">{formatDate(session.slotDate)}</Section>
                <Section label="Time">
                  {new Date(session.startTime).toLocaleTimeString('en-GB', { timeStyle: 'short' })}
                  {' – '}
                  {new Date(session.endTime).toLocaleTimeString('en-GB', { timeStyle: 'short' })}
                </Section>
                <Section label="Checked In">{formatDateTime(session.checkedInAt)}</Section>
                <Section label="Checked Out">{formatDateTime(session.checkedOutAt)}</Section>
                {session.rejectionReason && (
                  <Section label="Rejection">{session.rejectionReason}</Section>
                )}
                {session.cancellationReason && (
                  <Section label="Cancelled">{session.cancellationReason}</Section>
                )}
              </div>

              {/* Timestamps */}
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Audit Trail</h3>
              <div>
                <Section label="Created">{formatDateTime(session.createdAt)}</Section>
                <Section label="Updated">{formatDateTime(session.updatedAt)}</Section>
              </div>
            </div>

            {/* Footer actions */}
            {actions && (
              <div className="border-t px-6 py-4 flex gap-3">{actions}</div>
            )}
          </>
        ) : (
          /* T063: empty state */
          <div className="flex flex-1 flex-col items-center justify-center text-center px-6 py-12">
            <svg
              className="h-12 w-12 text-gray-200 mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
            </svg>
            <p className="text-gray-500">Select a session to view details</p>
          </div>
        )}
      </aside>
    </>
  );
}