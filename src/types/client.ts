/**
 * Client entity types.
 *
 * Mirrors `prisma/schema.prisma::Client` plus the derived shapes the API
 * returns (with `sessionCount`, etc.). Kept in `src/types/` so they can
 * be imported by both server (service + API routes) and client (UI) code.
 */

import type { ClientStatus, Gender } from '@prisma/client';

/** Re-export enums for consumers who don't want to depend on @prisma/client. */
export { ClientStatus, Gender };
export type GenderValue = Gender;
export type ClientStatusValue = ClientStatus;

/** Raw DB shape (matches `prisma.client.findFirst()` row). */
export interface Client {
  id: string;
  userId: string;
  practiceId: string;
  uniqueClientId: string;
  fullName: string;
  email: string;
  mobileNumber: string;
  dateOfBirth: Date;
  gender: Gender;
  address: string | null;
  emergencyContact: string | null;
  notes: string | null;
  status: ClientStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** API response shape with session count (matches GET /clients/[id]). */
export interface ClientDetail extends Client {
  sessionCount: number;
}

/** Compact list-row shape (matches GET /clients). */
export interface ClientListItem {
  id: string;
  uniqueClientId: string;
  fullName: string;
  email: string;
  mobileNumber: string;
  status: ClientStatus;
  sessionCount: number;
  createdAt: Date;
}

/** Pagination envelope (matches API contracts/api.md). */
export interface Pagination {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}

/** Filter / search params for the list endpoint. */
export interface ClientListFilters {
  page: number;
  limit: number;
  search?: string;
  status?: ClientStatus;
}

/** Editable field subsets per role — referenced by PATCH endpoint. */
export type ClientEditableField =
  | 'fullName'
  | 'email'
  | 'mobileNumber'
  | 'dateOfBirth'
  | 'gender'
  | 'address'
  | 'emergencyContact'
  | 'notes'
  | 'status';

/** Fields a CLIENT role may edit on their own profile (FR-004). */
export const CLIENT_SELF_EDITABLE: ReadonlyArray<ClientEditableField> = [
  'mobileNumber',
  'address',
  'emergencyContact',
  'notes',
] as const;

/** Fields staff (CLINIC_ADMIN / RECEPTIONIST) may edit. */
export const STAFF_EDITABLE: ReadonlyArray<ClientEditableField> = [
  'fullName',
  'mobileNumber',
  'address',
  'emergencyContact',
  'notes',
] as const;
