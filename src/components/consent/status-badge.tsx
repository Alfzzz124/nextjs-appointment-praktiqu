// src/components/consent/status-badge.tsx
'use client';

type Status = 'PENDING' | 'SIGNED' | 'DECLINED' | 'EXPIRED' | 'WITHDRAWN';

const labels: Record<Status, string> = {
  PENDING: 'Awaiting signature',
  SIGNED: 'Signed',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  WITHDRAWN: 'Withdrawn',
};

const colors: Record<Status, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  SIGNED: 'bg-green-100 text-green-800',
  DECLINED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-gray-100 text-gray-600',
  WITHDRAWN: 'bg-gray-100 text-gray-600',
};

export function StatusBadge({ status }: { status: Status | null | undefined }) {
  if (!status) return <span className="text-gray-400">No signature</span>;
  const s = status as Status;
  return (
    <span className={`rounded px-2 py-1 text-xs ${colors[s] ?? 'bg-gray-100 text-gray-600'}`}>
      {labels[s] ?? status}
    </span>
  );
}

export default StatusBadge;