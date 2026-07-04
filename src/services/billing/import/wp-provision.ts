import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';

export interface ProvisionWpUserOpts {
  name: string;
  email: string;
  clinicId: bigint;
  /** Serialized WP capability, e.g. 'a:1:{s:15:"kiviCare_doctor";b:1;}'. */
  capabilitySerialized: string;
  mappingTable: 'wp_kc_doctor_clinic_mappings' | 'wp_kc_patient_clinic_mappings';
  mappingIdCol: 'doctor_id' | 'patient_id';
  /** The doctor mapping carries an `owner` column; the patient mapping does not. */
  mappingHasOwner: boolean;
}

/**
 * Create a wp_users row + capability meta + clinic mapping in ONE interactive transaction
 * (LAST_INSERT_ID is connection-safe). Returns the new wp_users.ID.
 *
 * `mappingTable`/`mappingIdCol` come from a fixed internal union (never user input), so
 * interpolating them is safe; every VALUES entry is bound with `?`.
 */
export async function provisionWpUser(opts: ProvisionWpUserOpts): Promise<number> {
  const existing = await prisma.$queryRawUnsafe<any[]>(
    `SELECT ID FROM wp_users WHERE user_email = ? LIMIT 1`,
    opts.email,
  );
  if (existing[0]) throw new KcError('A user with this email already exists', 409);

  const username = opts.email.split('@')[0].slice(0, 60);
  const first = opts.name.split(' ')[0];
  const last = opts.name.split(' ').slice(1).join(' ') || '-';
  // Non-loginable placeholder hash; real auth is via the WP plugin. (No secret material.)
  const placeholderHash = '!disabled-' + username.slice(0, 20);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO wp_users (user_login, user_pass, user_nicename, display_name, user_email, user_url, user_registered, user_activation_key, user_status)
       VALUES (?, ?, ?, ?, ?, '', NOW(), '', 0)`,
      username, placeholderHash, username, opts.name, opts.email,
    );
    const idRow = await tx.$queryRawUnsafe<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    const wpId = Number(idRow[0].id);
    await tx.$executeRawUnsafe(
      `INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES
         (?, 'first_name', ?), (?, 'last_name', ?),
         (?, 'wp_capabilities', ?), (?, 'wp_user_level', '0')`,
      wpId, first, wpId, last, wpId, opts.capabilitySerialized, wpId,
    );
    if (opts.mappingHasOwner) {
      await tx.$executeRawUnsafe(
        `INSERT INTO ${opts.mappingTable} (${opts.mappingIdCol}, clinic_id, owner, created_at) VALUES (?, ?, 0, NOW())`,
        wpId, opts.clinicId,
      );
    } else {
      await tx.$executeRawUnsafe(
        `INSERT INTO ${opts.mappingTable} (${opts.mappingIdCol}, clinic_id, created_at) VALUES (?, ?, NOW())`,
        wpId, opts.clinicId,
      );
    }
    return wpId;
  });
}
