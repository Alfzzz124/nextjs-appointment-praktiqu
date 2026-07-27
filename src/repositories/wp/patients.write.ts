/**
 * Patient writes — via the praktiqu-endpoint plugin, never direct SQL.
 *
 * Reads live in `patients.repo.ts` and go straight to the database. Writes must not:
 * a raw INSERT into `wp_users` skips every listener KiviCare registers on
 * `kc_patient_save` — the welcome email (KCPatientNotificationListener), KiviCare's
 * own bookkeeping (KCPatientControllerFilters), and Pro's custom-field persistence
 * (KCPPatientControllerFilters). See docs/architecture/shadow-tables-audit.md §6 D1.
 *
 * The plugin owns the wp_usermeta layout, so this module deliberately sends flat
 * fields and lets PHP assemble the `basic_data` blob. Two implementations of that
 * shape would drift.
 */
import { WpEndpointError, wpRequestJson } from '@/lib/wp-endpoint';
import type { ClientStatus } from './patients.repo';

export type CreatePatientInput = {
  email: string;
  firstName: string;
  lastName?: string;
  /** Omit to have WordPress generate one and mail it via the welcome listener. */
  password?: string;
  contactNumber?: string;
  gender?: string;
  /** `YYYY-MM-DD`. */
  dateOfBirth?: string;
  address?: string;
  city?: string;
  country?: string;
  postalCode?: string;
  bloodGroup?: string;
  patientUniqueId?: string;
  timezone?: string;
  clinicId?: number;
  profileImageId?: number;
  /** ACTIVE | INACTIVE | ARCHIVED. Stored in wp_usermeta, never wp_users.user_status. */
  status?: ClientStatus;
};

/** Every field optional — the plugin merges into `basic_data` rather than replacing. */
export type UpdatePatientInput = Partial<Omit<CreatePatientInput, 'password'>>;

export type WrittenPatient = {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  contactNumber: string;
  patientUniqueId: string | null;
};

/** Plugin response shape (snake_case, mirroring PatientController). */
type PluginPatientResponse = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  contact_number: string;
  patient_unique_id: string | null;
};

/** Flatten to the snake_case body the plugin expects, omitting absent keys. */
function toRequestBody(input: CreatePatientInput | UpdatePatientInput): Record<string, unknown> {
  const map: Array<[keyof CreatePatientInput, string]> = [
    ['email', 'email'],
    ['firstName', 'first_name'],
    ['lastName', 'last_name'],
    ['password', 'password'],
    ['contactNumber', 'contact_number'],
    ['gender', 'gender'],
    ['dateOfBirth', 'dob'],
    ['address', 'address'],
    ['city', 'city'],
    ['country', 'country'],
    ['postalCode', 'postal_code'],
    ['bloodGroup', 'blood_group'],
    ['patientUniqueId', 'patient_unique_id'],
    ['timezone', 'timezone'],
    ['clinicId', 'clinic_id'],
    ['profileImageId', 'profile_image'],
    ['status', 'client_status'],
  ];

  const body: Record<string, unknown> = {};
  for (const [from, to] of map) {
    const value = (input as Record<string, unknown>)[from];
    // Only omit absent keys — '' and 0 are meaningful (clearing a field).
    if (value !== undefined) body[to] = value;
  }
  return body;
}

function toWrittenPatient(res: PluginPatientResponse): WrittenPatient {
  if (typeof res?.id !== 'number' || !Number.isFinite(res.id)) {
    throw new WpEndpointError('Patient write returned no id', 502);
  }
  return {
    id: res.id,
    email: res.email,
    firstName: res.first_name,
    lastName: res.last_name,
    contactNumber: res.contact_number,
    patientUniqueId: res.patient_unique_id ?? null,
  };
}

export async function createPatient(input: CreatePatientInput): Promise<WrittenPatient> {
  const res = await wpRequestJson<PluginPatientResponse>('/patients', {
    method: 'POST',
    body: toRequestBody(input),
  });
  return toWrittenPatient(res);
}

export async function updatePatient(
  wpUserId: number,
  input: UpdatePatientInput,
): Promise<WrittenPatient> {
  const res = await wpRequestJson<PluginPatientResponse>(`/patients/${wpUserId}`, {
    method: 'PUT',
    body: toRequestBody(input),
  });
  return toWrittenPatient(res);
}
