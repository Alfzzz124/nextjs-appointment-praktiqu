/**
 * Client entity types.
 *
 * A client IS a WordPress user carrying the `kiviCare_patient` capability. There is no
 * `clients` table — see docs/architecture/shadow-tables-audit.md.
 *
 * IDs are therefore `number` (`wp_users.ID`), not cuid strings. This is the D2
 * breaking change: it ships in one release with no compatibility shim.
 */

import type { ClientStatus } from '@/repositories/wp/patients.repo';

export type { ClientStatus };
export type ClientStatusValue = ClientStatus;

/** Gender is free text inside KiviCare's `basic_data` blob, not an enum. */
export type GenderValue = string;

/**
 * A client, assembled from `wp_users` + `wp_usermeta`.
 *
 * Profile fields are nullable: WordPress permits a user with no `basic_data` meta at
 * all, and patients created through KiviCare's own UI often have partial profiles.
 */
export interface Client {
  /** `wp_users.ID`. */
  id: number;
  /** From `wp_kc_patient_clinic_mappings` — null when the patient is unmapped. */
  clinicId: number | null;
  /** `patient_unique_id` meta, e.g. "PAT-0001". */
  uniqueClientId: string | null;
  fullName: string;
  email: string;
  mobileNumber: string | null;
  /** `YYYY-MM-DD` from `basic_data.dob`. A string, not a Date — that is how KiviCare stores it. */
  dateOfBirth: string | null;
  gender: GenderValue | null;
  address: string | null;
  emergencyContact: string | null;
  notes: string | null;
  status: ClientStatus;
  createdAt: Date;
}

/** API response shape with session count (matches GET /clients/[id]). */
export interface ClientDetail extends Client {
  sessionCount: number;
}

/** Compact list-row shape (matches GET /clients). */
export interface ClientListItem {
  id: number;
  uniqueClientId: string | null;
  fullName: string;
  email: string;
  mobileNumber: string | null;
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
