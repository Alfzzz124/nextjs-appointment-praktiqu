/**
 * The marker that makes a doctor-service mapping a duration option of another mapping.
 *
 * Stored in `wp_kc_service_doctor_mapping.extra` (LONGTEXT). KiviCare declares that column
 * but never writes it — core, Pro, the telemed and Meet add-ons and praktiqu-endpoint were
 * all checked on 2026-11-05; KiviCare only echoes it back in two API responses. We write it
 * only on option rows we create (and when we remove one), never on an existing row, so
 * anything else found in the column is left alone and read as "not an option".
 *
 * Spec: docs/superpowers/specs/2026-11-05-opsi-durasi-layanan-design.md
 */
export const DURATION_OF_KEY = 'praktiqu_duration_of';
export const REMOVED_KEY = 'praktiqu_duration_of_removed';

export type OptionMarker = {
  /** The parent's mapping id. */
  parentId: bigint;
  /** Removed options keep their parent for reports and the dashboard, but are dead. */
  removed: boolean;
};

function toId(raw: unknown): bigint | null {
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0) return BigInt(raw);
  if (typeof raw === 'string' && /^[1-9]\d*$/.test(raw)) return BigInt(raw);
  return null;
}

/** The marker on this row, live or removed, or null. Never throws. */
export function readMarker(extra: string | null | undefined): OptionMarker | null {
  if (!extra) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(extra);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  const live = toId(obj[DURATION_OF_KEY]);
  if (live !== null) return { parentId: live, removed: false };
  const removed = toId(obj[REMOVED_KEY]);
  if (removed !== null) return { parentId: removed, removed: true };
  return null;
}

/** The parent of a LIVE option, or null (not an option, or a removed one). */
export function parseDurationOf(extra: string | null | undefined): bigint | null {
  const m = readMarker(extra);
  return m && !m.removed ? m.parentId : null;
}

export function optionMarker(parentId: bigint): string {
  return JSON.stringify({ [DURATION_OF_KEY]: Number(parentId) });
}

export function removedMarker(parentId: bigint): string {
  return JSON.stringify({ [REMOVED_KEY]: Number(parentId) });
}

/**
 * Prisma `where` matching rows that carry either marker. Deliberately no closing quote:
 * `"praktiqu_duration_of` is a prefix of both keys. Candidates only — confirm with
 * `readMarker`, since free text could contain the same characters.
 */
export const ANY_OPTION_PROBE = { extra: { contains: `"${DURATION_OF_KEY}` } };
