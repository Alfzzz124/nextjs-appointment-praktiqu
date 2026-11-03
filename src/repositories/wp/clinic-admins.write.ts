/**
 * Clinic admin accounts — created by the praktiqu-endpoint plugin, never by direct SQL.
 *
 * A raw INSERT into wp_users stores an unusable password hash (the receptionist incident,
 * see receptionists.write.ts). The plugin uses wp_insert_user, claims the clinic's
 * clinic_admin_id (only while it is 0) and sends the welcome email. Plugin 1.8.0+.
 */
import { WpEndpointError, wpRequestJson } from '@/lib/wp-endpoint';

export type CreateClinicAdminInput = {
  name: string;
  email: string;
  /** A clinic that has no admin yet (clinic_admin_id = 0); the plugin refuses any other. */
  clinicId: number;
};

export type CreatedClinicAdmin = {
  id: number;
  email: string;
  clinicId: number;
  /** False when WordPress could not send the welcome email; the admin then uses "Lupa sandi". */
  emailSent: boolean;
};

type PluginResponse = {
  id: number;
  email: string;
  username: string;
  clinic_id: number;
  email_sent: boolean;
};

export async function createClinicAdminViaPlugin(input: CreateClinicAdminInput): Promise<CreatedClinicAdmin> {
  const res = await wpRequestJson<PluginResponse | null>('/clinic-admins', {
    method: 'POST',
    body: { name: input.name, email: input.email, clinic_id: input.clinicId },
  });

  if (typeof res?.id !== 'number' || !Number.isFinite(res.id) || res.id <= 0) {
    throw new WpEndpointError('Clinic admin create returned no id', 502);
  }

  return { id: res.id, email: res.email, clinicId: res.clinic_id, emailSent: res.email_sent === true };
}
