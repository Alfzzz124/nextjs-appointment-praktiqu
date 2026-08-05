/**
 * Doctor (professional) writes — via the praktiqu-endpoint plugin, never direct SQL.
 *
 * Reads live in `doctors.repo.ts`. Writes must not: creating a doctor with a raw INSERT
 * skips the three `kc_doctor_save` listeners — the welcome email, KiviCare's own
 * bookkeeping, and Pro's custom-field persistence.
 *
 * See docs/architecture/shadow-tables-audit.md §6 D1.
 */
import { WpEndpointError, wpRequestJson } from '@/lib/wp-endpoint';
import type { ProfessionalStatus, ProfessionalType } from './doctors.repo';

export type CreateDoctorInput = {
  email: string;
  firstName: string;
  lastName?: string;
  /** Omit to have WordPress generate one; the welcome email delivers it. */
  password?: string;
  professionalType: ProfessionalType;
  registrationNumber: string;
  contactNumber?: string;
  gender?: string;
  dateOfBirth?: string;
  address?: string;
  city?: string;
  country?: string;
  postalCode?: string;
  qualifications?: string[];
  specialties?: string[];
  yearsOfExperience?: string;
  description?: string;
  timezone?: string;
  clinicId?: number;
  profileImageId?: number;
};

/**
 * All optional — the plugin merges into `basic_data` rather than replacing it.
 * `status` is only settable on update: a new professional always starts
 * PENDING_ACTIVATION, which the plugin enforces.
 */
export type UpdateDoctorInput = Partial<Omit<CreateDoctorInput, 'password'>> & {
  status?: ProfessionalStatus;
};

export type WrittenDoctor = {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  registrationNumber: string | null;
  professionalType: ProfessionalType | null;
  status: ProfessionalStatus | null;
};

type PluginResponse = {
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
  registration_number: string | null;
  professional_type: string | null;
  professional_status: string | null;
};

function toRequestBody(input: CreateDoctorInput | UpdateDoctorInput): Record<string, unknown> {
  const map: Array<[string, string]> = [
    ['email', 'email'],
    ['firstName', 'first_name'],
    ['lastName', 'last_name'],
    ['password', 'password'],
    ['professionalType', 'professional_type'],
    ['registrationNumber', 'registration_number'],
    ['status', 'professional_status'],
    ['contactNumber', 'contact_number'],
    ['gender', 'gender'],
    ['dateOfBirth', 'dob'],
    ['address', 'address'],
    ['city', 'city'],
    ['country', 'country'],
    ['postalCode', 'postal_code'],
    ['qualifications', 'qualifications'],
    ['specialties', 'specialties'],
    ['yearsOfExperience', 'experience'],
    ['description', 'description'],
    ['timezone', 'timezone'],
    ['clinicId', 'clinic_id'],
    ['profileImageId', 'profile_image'],
  ];

  const body: Record<string, unknown> = {};
  for (const [from, to] of map) {
    const value = (input as Record<string, unknown>)[from];
    // Only omit absent keys — '' and [] are meaningful (clearing a field).
    if (value !== undefined) body[to] = value;
  }
  return body;
}

function toWrittenDoctor(res: PluginResponse): WrittenDoctor {
  if (typeof res?.user_id !== 'number' || !Number.isFinite(res.user_id)) {
    throw new WpEndpointError('Doctor write returned no id', 502);
  }
  return {
    id: res.user_id,
    email: res.email,
    firstName: res.first_name,
    lastName: res.last_name,
    registrationNumber: res.registration_number ?? null,
    professionalType: (res.professional_type as ProfessionalType) ?? null,
    status: (res.professional_status as ProfessionalStatus) ?? null,
  };
}

export async function createDoctor(input: CreateDoctorInput): Promise<WrittenDoctor> {
  return toWrittenDoctor(
    await wpRequestJson<PluginResponse>('/doctors', { method: 'POST', body: toRequestBody(input) }),
  );
}

export async function updateDoctor(
  wpUserId: number,
  input: UpdateDoctorInput,
): Promise<WrittenDoctor> {
  return toWrittenDoctor(
    await wpRequestJson<PluginResponse>(`/doctors/${wpUserId}`, {
      method: 'PUT',
      body: toRequestBody(input),
    }),
  );
}
