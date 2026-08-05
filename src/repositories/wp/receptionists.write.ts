/**
 * Receptionist writes — via the praktiqu-endpoint plugin, never direct SQL.
 *
 * The raw-SQL path this replaces produced an account that was completely unusable:
 * it wrote `user_pass = '!disabled-<username>'`, which is not a valid WordPress hash,
 * so `wp_check_password` in the plugin's authenticate always failed and no flow ever
 * set a real one. It also skipped `kc_receptionist_save`, so the welcome email that
 * would have delivered the password never fired either.
 *
 * See docs/architecture/shadow-tables-audit.md §6 Q1.
 */
import { WpEndpointError, wpRequestJson } from '@/lib/wp-endpoint';

export type CreateReceptionistInput = {
  name: string;
  email: string;
  clinicId: number;
  /** Omit to have WordPress generate one; the welcome email delivers it. */
  password?: string;
};

export type CreatedReceptionist = {
  id: number;
  email: string;
  clinicId: number;
};

type PluginResponse = {
  id: number;
  email: string;
  clinic_id: number;
};

export async function createReceptionistViaPlugin(
  input: CreateReceptionistInput,
): Promise<CreatedReceptionist> {
  const res = await wpRequestJson<PluginResponse>('/receptionists', {
    method: 'POST',
    body: {
      name: input.name,
      email: input.email,
      clinic_id: input.clinicId,
      ...(input.password !== undefined ? { password: input.password } : {}),
    },
  });

  if (typeof res?.id !== 'number' || !Number.isFinite(res.id)) {
    throw new WpEndpointError('Receptionist create returned no id', 502);
  }

  return { id: res.id, email: res.email, clinicId: res.clinic_id };
}
