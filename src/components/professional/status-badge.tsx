'use client';

/**
 * Status badge for professional status.
 */

import type { ProfessionalStatus } from '@prisma/client';

const STATUS_LABELS: Record<ProfessionalStatus, string> = {
  PENDING_ACTIVATION: 'Pending',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

const STATUS_COLORS: Record<ProfessionalStatus, string> = {
  PENDING_ACTIVATION: '#f59e0b',
  ACTIVE: '#10b981',
  INACTIVE: '#6b7280',
};

interface StatusBadgeProps {
  status: ProfessionalStatus;
  className?: string;
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium text-white ${className}`}
      style={{ backgroundColor: STATUS_COLORS[status] }}
      data-status={status}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}