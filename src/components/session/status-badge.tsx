/**
 * Status badge component.
 *
 * Color map matches STATUS_COLOR in @/types/session.
 */

import type { SessionStatus } from '@prisma/client';
import { STATUS_COLOR } from '@/types/session';

const STATUS_LABEL: Record<SessionStatus, string> = {
  PENDING: 'Pending',
  BOOKED: 'Booked',
  CHECK_IN: 'Checked In',
  CHECK_OUT: 'Checked Out',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

interface StatusBadgeProps {
  status: SessionStatus;
  className?: string;
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const color = STATUS_COLOR[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium text-white ${className}`}
      style={{ backgroundColor: color }}
      data-status={status}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}