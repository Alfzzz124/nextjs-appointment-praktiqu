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
import { countOwnedClinics, isClinicAdminUser } from '@/repositories/wp/clinic-admins.repo';
import { resolveClinicPaymentManyForDisplay } from '@/services/payments/clinic-payment.service';
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

function toPracticeDTO(c: WpClinic, international: boolean): PracticeDTO {
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
    international,
    createdAt: c.createdAt.toISOString(),
    // KiviCare's clinics table has no updated_at column. Mirroring createdAt is
    // honest; inventing `now()` would not be.
    updatedAt: c.createdAt.toISOString(),
  };
}

/**
 * DTOs for a page of clinics, with one settings read for the whole page. Never throws:
 * a failed read is logged and every clinic reads `international: false`.
 */
async function toPracticeDTOs(clinics: WpClinic[]): Promise<PracticeDTO[]> {
  const payment = await resolveClinicPaymentManyForDisplay(clinics.map((c) => Number(c.id)));
  return clinics.map((c) => toPracticeDTO(c, payment.get(Number(c.id))?.international ?? false));
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

/**
 * Pass `actor` from any route: a CLINIC_ADMIN then sees only their own clinic, the
 * rule `assertPracticeInScope` already applies to `/practices/:id`. Without it the list
 * returned every clinic, which the Laravel FE rightly flagged as out-of-scope data and
 * so hid every clinic admin's statistics behind a warning banner.
 */
export async function listPractices(
  options: ListOptions = {},
  actor?: Actor,
): Promise<{ data: PracticeDTO[]; total: number }> {
  let ids: bigint[] | undefined;
  if (actor && actor.role !== 'SUPER_ADMIN') {
    const kc = await resolveKcActor(actor);
    ids = kc.clinicId === null ? [] : [kc.clinicId];
  }
  const { items, total } = await listClinicRows({
    page: options.page ?? 1,
    perPage: options.limit ?? 20,
    search: options.search,
    includeInactive: options.includeInactive,
    ids,
  });
  return { data: await toPracticeDTOs(items), total };
}

export async function getPractice(id: number): Promise<PracticeDTO> {
  const clinic = await findClinicById(BigInt(id));
  if (!clinic) throw new PracticeNotFoundError(id);
  const [dto] = await toPracticeDTOs([clinic]);
  return dto;
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
    out.push(...(await toPracticeDTOs(items)));
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

/** `newAdminId` is not a WordPress account holding the kiviCare_clinic_admin capability. */
export class NotAClinicAdminError extends Error {
  constructor(public readonly wpUserId: number) {
    super(`WordPress user ${wpUserId} is not a clinic admin`);
    this.name = 'NotAClinicAdminError';
  }
}

export interface ChangePracticeAdminResult {
  clinicId: number;
  adminId: number;
  previousAdminId: number;
  /** Clinics the previous admin still owns after this change; 0 = they now hold none. */
  previousAdminClinicCount: number;
  /** True when `newAdminId` already was the admin: nothing was written or audited. */
  unchanged: boolean;
}

/**
 * Make `newAdminId` (a wp_users.ID) the admin of a clinic. A clinic has exactly one admin;
 * one admin may hold several clinics and picks one per request with X-Praktiqu-Clinic-Id.
 * The previous admin loses this clinic at once: their next request naming it gets 403.
 */
export async function changePracticeAdmin(
  practiceId: number,
  newAdminId: number,
  actorId: string,
): Promise<ChangePracticeAdminResult> {
  const clinic = await findClinicById(BigInt(practiceId));
  if (!clinic) throw new PracticeNotFoundError(practiceId);
  if (!(await isClinicAdminUser(BigInt(newAdminId)))) throw new NotAClinicAdminError(newAdminId);

  const previousAdminId = Number(clinic.clinicAdminId);
  const unchanged = previousAdminId === newAdminId;
  if (!unchanged) {
    // clinic_admin_id is outside UpdateClinicInput, which covers the contact fields, so
    // it is set explicitly rather than widening that type for one caller.
    const { prisma } = await import('@/lib/db');
    await prisma.$executeRawUnsafe(
      `UPDATE wp_kc_clinics SET clinic_admin_id = ? WHERE id = ?`,
      newAdminId,
      practiceId,
    );
    // userId is the caller's users.id (a cuid): log_entries.userId is a foreign key to
    // users.id, and logging swallows insert errors, so a wp_users.ID here would drop the row.
    await logging.audit('practice.admin_changed', {
      userId: actorId,
      resource: 'clinic',
      resourceId: String(practiceId),
      metadata: { previousAdminId, newAdminId },
    });
  }

  return {
    clinicId: practiceId,
    adminId: newAdminId,
    previousAdminId,
    previousAdminClinicCount: await countOwnedClinics(BigInt(previousAdminId)),
    unchanged,
  };
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
