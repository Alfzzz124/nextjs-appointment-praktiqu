/**
 * Session entity types.
 *
 * Source of truth: specs/005-session-mgmt/data-model.md
 *
 * The runtime `SessionStatus` enum comes from `@prisma/client` (DB-level).
 * The shapes below are domain types used across services, API routes, and
 * UI components. They are deliberately decoupled from the Prisma row so the
 * API contract can evolve independently of the storage representation.
 */

import type { SessionStatus } from '@prisma/client';

export { SessionStatus };

/** Session record as exposed by the API (camelCase, ISO timestamps). */
export interface SessionEntity {
  id: string;
  clientId: string;
  professionalId: string;
  serviceId: string;
  practiceId: string;
  /** ISO date (YYYY-MM-DD) of the session in UTC. */
  slotDate: string;
  /** ISO datetime (UTC) of the session start. */
  startTime: string;
  /** ISO datetime (UTC) of the session end. */
  endTime: string;
  status: SessionStatus;
  rejectionReason: string | null;
  cancellationReason: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Session with related client / professional / service records (list/detail views). */
export interface SessionWithRelations extends SessionEntity {
  client: SessionClient;
  professional: SessionProfessional;
  service: SessionService;
}

export interface SessionClient {
  id: string;
  fullName: string;
  uniqueClientId: string | null;
  mobileNumber: string | null;
  email: string | null;
}

export interface SessionProfessional {
  id: string;
  fullName: string;
  email: string | null;
}

export interface SessionService {
  id: string;
  name: string;
  durationMinutes: number;
}

/** Inputs for creating a new session (used by validation schemas). */
export interface CreateSessionInput {
  clientId: string;
  professionalId: string;
  serviceId: string;
  /** YYYY-MM-DD */
  slotDate: string;
  /** ISO 8601 datetime */
  startTime: string;
}

/** Calendar view. */
export type CalendarView = 'day' | 'week' | 'month';

export interface CalendarSessionEntry {
  id: string;
  startTime: string;
  endTime: string;
  client: string;
  service: string;
  status: SessionStatus;
  /** Hex colour for status (used by UI). */
  statusColor: string;
  professionalId: string;
  professionalName: string;
}

export interface CalendarResponse {
  view: CalendarView;
  /** YYYY-MM-DD */
  date: string;
  sessions: CalendarSessionEntry[];
}

/** Status transition map (see data-model.md for the canonical rules). */
export const VALID_TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  PENDING: ['BOOKED', 'REJECTED', 'CANCELLED'],
  BOOKED: ['CHECK_IN', 'CANCELLED'],
  CHECK_IN: ['CHECK_OUT'],
  CHECK_OUT: ['COMPLETED'],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
} as const;

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/** Color tokens for the UI status badge (kept in sync with status-badge.tsx). */
export const STATUS_COLOR: Record<SessionStatus, string> = {
  PENDING: '#eab308',     // yellow
  BOOKED: '#22c55e',      // green
  CHECK_IN: '#3b82f6',    // blue
  CHECK_OUT: '#8b5cf6',   // purple
  COMPLETED: '#6b7280',   // gray
  REJECTED: '#ef4444',    // red
  CANCELLED: '#6b7280',   // gray
};

/** Pagination envelope. */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
  };
}

/** Filters accepted by GET /sessions and the calendar endpoint. */
export interface SessionListFilters {
  status?: SessionStatus;
  clientId?: string;
  professionalId?: string;
  serviceId?: string;
  /** YYYY-MM-DD */
  dateFrom?: string;
  /** YYYY-MM-DD */
  dateTo?: string;
}
