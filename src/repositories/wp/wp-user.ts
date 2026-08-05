/**
 * Shared mechanics for reading KiviCare actors out of WordPress.
 *
 * Patients, doctors and receptionists are all `wp_users` rows distinguished only by
 * the capability held in `wp_usermeta`. Their profiles all live in per-key meta rows
 * plus a `basic_data` JSON blob. That machinery lives here; the per-role repositories
 * supply their own role slug, meta keys and output shape.
 *
 * Reference: KCWPUser.php:135-136 (role filter), PatientController.php:1083-1121 and
 * DoctorController.php:1079-1106 (meta joins), KCPatient.php:128-145 /
 * KCDoctor.php:139-151 (basic_data).
 */

/** Role slugs are KIVI_CARE_PREFIX . '<role>' on the PHP side. */
export const KIVICARE_ROLES = {
  patient: 'kiviCare_patient',
  doctor: 'kiviCare_doctor',
  receptionist: 'kiviCare_receptionist',
  clinicAdmin: 'kiviCare_clinic_admin',
} as const;

export type KivicareRole = (typeof KIVICARE_ROLES)[keyof typeof KIVICARE_ROLES];

/**
 * The capability meta key is `<prefix>capabilities`. Deriving it from the configured
 * prefix means a renamed-prefix install fails loudly rather than silently returning
 * zero users.
 */
export const WP_PREFIX = process.env.WP_TABLE_PREFIX ?? 'wp_';
export const CAPABILITIES_KEY = `${WP_PREFIX}capabilities`;

/**
 * WordPress stores capabilities as a serialised PHP array:
 *   a:1:{s:16:"kiviCare_doctor";b:1;}
 * The role must be matched with its surrounding quotes — bare `kiviCare_patient`
 * would also match a hypothetical `kiviCare_patient_admin`.
 */
export function roleLikePattern(role: KivicareRole): string {
  return `%"${role}"%`;
}

/** Capability check as an EXISTS subquery. Binds `CAPABILITIES_KEY` then the pattern. */
export const HAS_ROLE_SQL = `
  EXISTS (
    SELECT 1 FROM wp_usermeta cap
    WHERE cap.user_id = u.ID
      AND cap.meta_key = ?
      AND cap.meta_value LIKE ?
  )`;

/**
 * One aliased LEFT JOIN per meta key, so a user with no rows for a key still comes
 * back (with NULLs) rather than dropping out of the result.
 *
 * Meta keys are interpolated, never bound — they are module-level constants, never
 * user input. Guarded anyway so a future caller can't smuggle SQL through.
 */
export function metaJoins(keys: readonly string[]): string {
  return keys.map((key) => {
    assertSafeMetaKey(key);
    return `LEFT JOIN wp_usermeta AS m_${key} ON m_${key}.user_id = u.ID AND m_${key}.meta_key = '${key}'`;
  }).join('\n       ');
}

export function metaSelects(keys: readonly string[]): string {
  return keys.map((key) => {
    assertSafeMetaKey(key);
    return `m_${key}.meta_value AS ${key}`;
  }).join(',\n              ');
}

function assertSafeMetaKey(key: string): void {
  if (!/^[a-z0-9_]+$/i.test(key)) {
    throw new Error(`Unsafe wp_usermeta key for SQL interpolation: ${JSON.stringify(key)}`);
  }
}

/**
 * `basic_data` is written by the KiviCare models as JSON. It can be absent, empty, or
 * malformed on rows touched outside KiviCare — never let that fail a read.
 */
export function decodeBasicData(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Normalise a meta value: absent, null and empty-string all collapse to null. */
export function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/**
 * Keys KiviCare uses for the human-readable part of a list entry, most specific first.
 *
 * Measured against real staging data: specialties are `{id, label}`, qualifications are
 * `{degree, university, year, file}`. `name` and `value` are generic fallbacks other
 * KiviCare versions and add-ons use.
 */
const LABEL_KEYS = ['label', 'degree', 'name', 'value', 'title'] as const;

/**
 * The display label for one entry of a `basic_data` list.
 *
 * Entries are sometimes plain strings and sometimes objects, depending on the field and
 * the KiviCare version that wrote them. An object with no recognised key yields null
 * rather than `String(obj)` — which is how `[object Object]` reached the public
 * professional directory before this existed.
 */
export function labelOf(entry: unknown): string | null {
  if (entry === null || entry === undefined) return null;
  if (typeof entry === 'object') {
    const o = entry as Record<string, unknown>;
    for (const key of LABEL_KEYS) {
      const found = str(o[key]);
      if (found !== null) return found;
    }
    return null;
  }
  return str(entry);
}

/** Coerce a `basic_data` field that KiviCare stores as an array (or `''` when unset). */
export function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(labelOf).filter((v): v is string => v !== null);
}

/** Escape LIKE wildcards so a search for "100%" doesn't match every row. */
export function likeTerm(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Clamp pagination to sane bounds. */
export function paginate(page: number, perPage: number): { page: number; perPage: number; offset: number } {
  const p = Math.max(1, Math.trunc(page));
  const pp = Math.min(100, Math.max(1, Math.trunc(perPage)));
  return { page: p, perPage: pp, offset: (p - 1) * pp };
}

/** Columns every role read selects from `wp_users`. */
export const USER_COLUMNS = 'u.ID, u.user_email, u.display_name, u.user_registered';

export type BaseUserRow = {
  ID: bigint | number;
  user_email: string;
  display_name: string;
  user_registered: Date;
};
