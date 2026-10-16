/**
 * Which names and emails a clinic may have.
 *
 * A clinic's public booking link is `/{slugifyName(name)}` — the FE builds it with
 * BookingApi::slugify(), which slugifyName mirrors byte for byte. The FE resolves `/{slug}`
 * to a clinic by exact id first, then by slug, and only then to a professional's personal
 * link. So a name is refused when its slug would be empty, all digits (read as another
 * clinic's id), a word the FE routes use, another clinic's slug (inactive ones too — they
 * can be reactivated), or an active professional's slug.
 *
 * Spec: docs/superpowers/specs/2026-10-15-crud-klinik-design.md §2c.
 */
import { slugifyName } from '@/lib/public/professional-slug';
import { findClinicIdByEmail, listClinicNames } from '@/repositories/wp/clinics.repo';
import { listActiveProfessionalSlugs } from '@/services/public/public-catalog.service';

/** The FE's `{tenant}` route excludes these (routes/web.php). */
export const RESERVED_SLUGS: readonly string[] = [
  'admin',
  'klinik',
  'psikolog',
  'login',
  'logout',
  'booking',
  'staff',
  'doctor',
  'pasien',
  'cek-hasil',
  'up',
  'forgot-password',
  'reset-password',
  'lupa-sandi',
  'atur-ulang-sandi',
];

export type ClinicNameProblemReason =
  | 'empty_slug'
  | 'numeric_slug'
  | 'reserved_slug'
  | 'clinic_slug_taken'
  | 'professional_slug_taken';

export interface ClinicNameProblem {
  reason: ClinicNameProblemReason;
  slug: string;
  conflictId?: number;
  conflictName?: string;
}

export class ClinicNameConflictError extends Error {
  constructor(public readonly problem: ClinicNameProblem) {
    super(`Clinic name refused: ${problem.reason} (${problem.slug})`);
    this.name = 'ClinicNameConflictError';
  }
}

export class ClinicEmailConflictError extends Error {
  constructor(
    public readonly email: string,
    public readonly conflictId: number,
  ) {
    super(`Clinic ${conflictId} already uses ${email}`);
    this.name = 'ClinicEmailConflictError';
  }
}

/** Pure: the first rule this name breaks, or null. `exceptId` is the clinic being renamed. */
export function findClinicNameProblem(
  name: string,
  ctx: {
    clinics: Array<{ id: number; name: string | null }>;
    professionalSlugs: ReadonlySet<string>;
    exceptId?: number;
  },
): ClinicNameProblem | null {
  const slug = slugifyName(name);
  if (slug === '') return { reason: 'empty_slug', slug };
  if (/^[0-9]+$/.test(slug)) return { reason: 'numeric_slug', slug };
  if (RESERVED_SLUGS.includes(slug)) return { reason: 'reserved_slug', slug };

  const clash = ctx.clinics.find((c) => c.id !== ctx.exceptId && slugifyName(c.name ?? '') === slug);
  if (clash) {
    return { reason: 'clinic_slug_taken', slug, conflictId: clash.id, conflictName: clash.name ?? '' };
  }

  if (ctx.professionalSlugs.has(slug)) return { reason: 'professional_slug_taken', slug };
  return null;
}

export async function assertClinicNameAvailable(name: string, opts: { exceptId?: number } = {}): Promise<void> {
  const [clinics, professionalSlugs] = await Promise.all([listClinicNames(), listActiveProfessionalSlugs()]);
  const problem = findClinicNameProblem(name, { clinics, professionalSlugs, exceptId: opts.exceptId });
  if (problem) throw new ClinicNameConflictError(problem);
}

/** KiviCare refuses a second clinic with the same email; so do we. An empty email is fine. */
export async function assertClinicEmailAvailable(
  email: string | null | undefined,
  opts: { exceptId?: number } = {},
): Promise<void> {
  const wanted = email?.trim() ?? '';
  if (wanted === '') return;
  const conflictId = await findClinicIdByEmail(wanted, opts.exceptId);
  if (conflictId !== null) throw new ClinicEmailConflictError(wanted, conflictId);
}
