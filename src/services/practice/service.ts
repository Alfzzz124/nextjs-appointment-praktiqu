/**
 * Practice service — backed by KiviCare's `wp_kc_clinics`.
 *
 * A "practice" is a KiviCare clinic. The `clinics` shadow table duplicated it, and
 * `holiday_list` / `clinic_schedules` duplicated `wp_kc_clinic_schedule`. See
 * docs/architecture/shadow-tables-audit.md.
 *
 * Reads and writes are both direct SQL. KiviCare declares clinic and holiday hooks but
 * registers no listener for any of them, so a direct write skips nothing — the same
 * evidence that justified it for clinic sessions.
 *
 * Ids are `number` (`wp_kc_clinics.id`).
 */

import type { Actor } from '@/lib/auth';
import { logging } from '@/lib/logging';
import { resolveKcActor } from '@/services/billing/kc-actor';
import {
  findClinicById,
  listClinicMembers,
  listClinics as listClinicRows,
  setClinicStatus,
  updateClinic,
  type WpClinic,
} from '@/repositories/wp/clinics.repo';
import {
  OFF_DAY_MODULE,
  createOffDay,
  deleteOffDay,
  listClinicOffDays,
  type WpOffDay,
} from '@/repositories/wp/off-days.repo';
import {
  HolidayDTO,
  PracticeDTO,
  holidayInputSchema,
  practiceUpdateSchema,
} from '@/types/practice';

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class PracticeNotFoundError extends Error {
  constructor(public readonly id: number) {
    super(`Practice ${id} not found`);
    this.name = 'PracticeNotFoundError';
  }
}

export class HolidayNotFoundError extends Error {
  constructor(public readonly id: number) {
    super(`Holiday ${id} not found`);
    this.name = 'HolidayNotFoundError';
  }
}

export class PracticeValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'PracticeValidationError';
  }
}

/**
 * A CLINIC_ADMIN may only touch their own practice — SUPER_ADMIN is unrestricted.
 * Every `/practices/:id` route (and its `/settings`, `/holidays`, `/users` siblings)
 * was gated on role alone, so any CLINIC_ADMIN could read or write ANY clinic by id.
 *
 * Throws `PracticeNotFoundError` (→ 404) rather than a 403 on mismatch: a 403 would
 * confirm the practice exists, which is exactly the row-scope leak this closes.
 *
 * The JWT's own `actor.practiceId` is a cuid left over from the retired shadow
 * schema (see `professionals/route.ts`) — the real clinic id has to come from
 * `resolveKcActor`, the same lookup bills and taxes use.
 *
 * This runs first, for every role, in every route that calls it — so it also guards
 * `Number(params.id)` being NaN (a non-numeric `:id` segment, e.g. `/practices/abc`).
 * Left unchecked, `BigInt(practiceId)` below throws an uncaught `RangeError`, which
 * surfaces as a 500 where the rest of the family (unknown-but-numeric id) answers 404.
 */
export async function assertPracticeInScope(actor: Actor, practiceId: number): Promise<void> {
  if (!Number.isInteger(practiceId)) throw new PracticeNotFoundError(practiceId);
  if (actor.role === 'SUPER_ADMIN') return;
  const kc = await resolveKcActor(actor);
  if (kc.clinicId === null || kc.clinicId !== BigInt(practiceId)) {
    throw new PracticeNotFoundError(practiceId);
  }
}

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

type BusinessHours = PracticeDTO['businessHours'][number];

function readBusinessHours(extra: Record<string, unknown>): BusinessHours[] {
  const value = extra.businessHours;
  return Array.isArray(value) ? (value as BusinessHours[]) : [];
}

function toPracticeDTO(c: WpClinic): PracticeDTO {
  // timezone, logoUrl and businessHours have no columns on KiviCare's table and
  // round-trip through `extra`, so adding fields needs no schema change.
  const extra = c.extra;
  return {
    id: Number(c.id),
    name: c.name ?? '',
    email: c.email,
    telephoneNo: c.telephone,
    address: c.address,
    city: c.city,
    state: c.state,
    country: c.country,
    postalCode: c.postalCode,
    countryCode: c.countryCode,
    countryCallingCode: c.countryCallingCode,
    timezone: typeof extra.timezone === 'string' ? extra.timezone : null,
    logoUrl: typeof extra.logoUrl === 'string' ? extra.logoUrl : null,
    status: c.isActive ? 1 : 0,
    businessHours: readBusinessHours(extra),
    createdAt: c.createdAt.toISOString(),
    // KiviCare's clinics table has no updated_at column. Mirroring createdAt is
    // honest; inventing `now()` would not be.
    updatedAt: c.createdAt.toISOString(),
  };
}

/** `HH:MM:SS` → `HH:mm`, the shape this DTO has always used. */
function toHHmm(t: string | null): string | null {
  return t ? t.slice(0, 5) : null;
}

function toHolidayDTO(o: WpOffDay): HolidayDTO {
  return {
    id: Number(o.id),
    practiceId: Number(o.moduleId),
    title: o.description ?? '',
    startDate: o.startDate ?? '',
    endDate: o.endDate ?? o.startDate ?? '',
    // Inverted deliberately: KiviCare's `time_specific` true means a PARTIAL closure.
    isAllDay: !o.timeSpecific,
    startTime: toHHmm(o.startTime),
    endTime: toHHmm(o.endTime),
  };
}

/* ------------------------------------------------------------------ */
/* Practices                                                           */
/* ------------------------------------------------------------------ */

export interface ListOptions {
  page?: number;
  limit?: number;
  search?: string;
  includeInactive?: boolean;
}

export async function listPractices(
  options: ListOptions = {},
): Promise<{ data: PracticeDTO[]; total: number }> {
  const { items, total } = await listClinicRows({
    page: options.page ?? 1,
    perPage: options.limit ?? 20,
    search: options.search,
    includeInactive: options.includeInactive,
  });
  return { data: items.map(toPracticeDTO), total };
}

export async function getPractice(id: number): Promise<PracticeDTO> {
  const clinic = await findClinicById(BigInt(id));
  if (!clinic) throw new PracticeNotFoundError(id);
  return toPracticeDTO(clinic);
}

export async function updatePractice(
  id: number,
  input: unknown,
  options: { actorId?: string | null } = {},
): Promise<PracticeDTO> {
  const parsed = practiceUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new PracticeValidationError(
      'Invalid practice input',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const data = parsed.data;

  const existing = await findClinicById(BigInt(id));
  if (!existing) throw new PracticeNotFoundError(id);

  // Only the extra-backed fields actually supplied are merged, so a partial update
  // cannot blank the others out of the shared blob.
  const extra: Record<string, unknown> = {};
  if (data.timezone !== undefined) extra.timezone = data.timezone;
  if (data.logoUrl !== undefined) extra.logoUrl = data.logoUrl;
  if (data.businessHours !== undefined) extra.businessHours = data.businessHours;

  await updateClinic(BigInt(id), {
    name: data.name,
    email: data.email,
    telephone: data.telephoneNo,
    address: data.address,
    city: data.city,
    state: data.state,
    country: data.country,
    postalCode: data.postalCode,
    countryCode: data.countryCode,
    countryCallingCode: data.countryCallingCode,
    status: data.status === undefined ? undefined : data.status === 1 ? 1 : 0,
    extra: Object.keys(extra).length > 0 ? extra : undefined,
  });

  await logging.audit('practice.update', {
    userId: options.actorId ?? null,
    resource: 'practice',
    resourceId: String(id),
    metadata: { fields: Object.keys(data) },
  });

  return getPractice(id);
}

/** Soft-delete: sets status to 0. */
export async function bulkDeletePractices(ids: number[]): Promise<number> {
  return setClinicStatus(ids.map((i) => BigInt(i)), 0);
}

export async function bulkSetPracticeStatus(ids: number[], status: number): Promise<number> {
  return setClinicStatus(ids.map((i) => BigInt(i)), status === 1 ? 1 : 0);
}

export async function exportPractices(params: { status?: number } = {}): Promise<PracticeDTO[]> {
  const out: PracticeDTO[] = [];
  for (let page = 1; ; page += 1) {
    const { items, total } = await listClinicRows({ page, perPage: 100, includeInactive: true });
    out.push(...items.map(toPracticeDTO));
    if (items.length === 0 || out.length >= total) break;
  }
  return params.status === undefined ? out : out.filter((p) => p.status === params.status);
}

/** Everyone mapped to a practice, across KiviCare's three mapping tables. */
export async function listPracticeUsers(
  practiceId: number,
): Promise<Array<{ userId: number; role: string }>> {
  const clinic = await findClinicById(BigInt(practiceId));
  if (!clinic) throw new PracticeNotFoundError(practiceId);

  const members = await listClinicMembers(BigInt(practiceId));
  return members.map((m) => ({ userId: Number(m.userId), role: m.role }));
}

export async function changePracticeAdmin(practiceId: number, newAdminId: number): Promise<void> {
  const clinic = await findClinicById(BigInt(practiceId));
  if (!clinic) throw new PracticeNotFoundError(practiceId);

  // clinic_admin_id is outside UpdateClinicInput, which covers the contact fields, so
  // it is set explicitly rather than widening that type for one caller.
  const { prisma } = await import('@/lib/db');
  await prisma.$executeRawUnsafe(
    `UPDATE wp_kc_clinics SET clinic_admin_id = ? WHERE id = ?`,
    newAdminId,
    practiceId,
  );
}

/* ------------------------------------------------------------------ */
/* Holidays                                                            */
/* ------------------------------------------------------------------ */

export async function listHolidays(practiceId: number): Promise<HolidayDTO[]> {
  const clinic = await findClinicById(BigInt(practiceId));
  if (!clinic) throw new PracticeNotFoundError(practiceId);

  return (await listClinicOffDays(BigInt(practiceId))).map(toHolidayDTO);
}

export async function addHoliday(
  practiceId: number,
  input: unknown,
  options: { actorId?: string | null } = {},
): Promise<HolidayDTO> {
  const parsed = holidayInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PracticeValidationError(
      'Invalid holiday input',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const data = parsed.data;

  if (data.endDate < data.startDate) {
    throw new PracticeValidationError('endDate must be on or after startDate', [
      { path: 'endDate', message: 'endDate must be on or after startDate' },
    ]);
  }

  const clinic = await findClinicById(BigInt(practiceId));
  if (!clinic) throw new PracticeNotFoundError(practiceId);

  // A part-day closure needs both bounds, or the slot generator cannot tell what it
  // covers and would have to treat it as a full day.
  const timeSpecific = !data.isAllDay;
  if (timeSpecific && (!data.startTime || !data.endTime)) {
    throw new PracticeValidationError('A part-day holiday needs both startTime and endTime', [
      { path: 'startTime', message: 'Required when isAllDay is false' },
    ]);
  }

  const withSeconds = (t: string | null | undefined): string | undefined =>
    t ? (t.length === 5 ? `${t}:00` : t) : undefined;

  const id = await createOffDay({
    module: OFF_DAY_MODULE.CLINIC,
    moduleId: BigInt(practiceId),
    startDate: data.startDate,
    endDate: data.endDate,
    timeSpecific,
    startTime: withSeconds(data.startTime),
    endTime: withSeconds(data.endTime),
    description: data.title,
  });

  await logging.audit('practice.holiday.add', {
    userId: options.actorId ?? null,
    resource: 'holiday',
    resourceId: String(id),
    metadata: { practiceId, title: data.title, startDate: data.startDate, endDate: data.endDate },
  });

  const created = (await listClinicOffDays(BigInt(practiceId))).find((o) => o.id === id);
  if (!created) throw new HolidayNotFoundError(Number(id));
  return toHolidayDTO(created);
}

export async function removeHoliday(
  practiceId: number,
  holidayId: number,
  options: { actorId?: string | null } = {},
): Promise<boolean> {
  // Scoped by clinic, so one practice cannot delete another's closure by id alone.
  const ok = await deleteOffDay({
    id: BigInt(holidayId),
    module: OFF_DAY_MODULE.CLINIC,
    moduleId: BigInt(practiceId),
  });
  if (!ok) throw new HolidayNotFoundError(holidayId);

  await logging.audit('practice.holiday.remove', {
    userId: options.actorId ?? null,
    resource: 'holiday',
    resourceId: String(holidayId),
    metadata: { practiceId },
  });
  return true;
}
