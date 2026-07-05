/**
 * Practice service — encapsulates all business logic for Practice and Holiday
 * resources. Routes and components call into this layer rather than touching
 * Prisma directly so that:
 *   - validation lives in one place (Zod)
 *   - audit logging is consistent (lib/logging)
 *   - tests can mock a single boundary
 *
 * The "Practice" maps to the KiviCare `Clinic` table.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logging } from '@/lib/logging';
import {
  HolidayDTO,
  PracticeDTO,
  PracticeUpdateInput,
  holidayInputSchema,
  practiceUpdateSchema,
} from '@/types/practice';

// ============================================================
// Errors
// ============================================================

export class PracticeNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Practice ${id} not found`);
    this.name = 'PracticeNotFoundError';
  }
}

export class HolidayNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Holiday ${id} not found`);
    this.name = 'HolidayNotFoundError';
  }
}

export class PracticeValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: ReadonlyArray<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'PracticeValidationError';
  }
}

// ============================================================
// Internal helpers
// ============================================================

/** Module type for Holiday rows attached to a Practice (KiviCare uses polymorphic). */
const PRACTICE_MODULE = 'clinic';

type PrismaLike = Pick<typeof prisma, 'clinic' | 'holiday'>;

/** Allow tests to inject a Prisma stub. Default: the singleton client. */
function client(injected?: PrismaLike): PrismaLike {
  return injected ?? prisma;
}

/** Convert the `extra` JSON blob (if any) to a safe settings object. */
function readExtra(
  extra: unknown,
): { businessHours?: PracticeDTO['businessHours'] } {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
    return {};
  }
  const obj = extra as Record<string, unknown>;
  const businessHours = obj.businessHours;
  if (!Array.isArray(businessHours)) return {};
  // Trust the shape — it was written via our service.
  return { businessHours: businessHours as PracticeDTO['businessHours'] };
}

function toDTO(record: {
  id: string;
  name: string;
  email: string | null;
  telephoneNo: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  countryCode: string | null;
  countryCallingCode: string | null;
  extra: unknown;
  status: number;
  createdAt: Date;
  updatedAt: Date;
}): PracticeDTO {
  const { businessHours = [] } = readExtra(record.extra);
  // `logoUrl` and `timezone` are not first-class columns on the KiviCare Clinic
  // table, so we round-trip them through `extra`. New fields can be added there
  // without a schema migration.
  const extra = (record.extra ?? {}) as Record<string, unknown>;
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    telephoneNo: record.telephoneNo,
    address: record.address,
    city: record.city,
    state: record.state,
    country: record.country,
    postalCode: record.postalCode,
    countryCode: record.countryCode,
    countryCallingCode: record.countryCallingCode,
    timezone: typeof extra.timezone === 'string' ? (extra.timezone as string) : null,
    logoUrl: typeof extra.logoUrl === 'string' ? (extra.logoUrl as string) : null,
    status: record.status === 1 ? 1 : 0,
    businessHours,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toHolidayDTO(record: {
  id: string;
  moduleId: string;
  title: string;
  startDate: Date;
  endDate: Date;
  isAllDay: boolean;
  startTime: Date | null;
  endTime: Date | null;
}): HolidayDTO {
  // `@db.Time` values come back as Dates whose UTC time part is the stored HH:mm.
  const toHHmm = (t: Date | null): string | null =>
    t ? t.toISOString().slice(11, 16) : null;
  return {
    id: record.id,
    practiceId: record.moduleId,
    title: record.title,
    startDate: record.startDate.toISOString().slice(0, 10),
    endDate: record.endDate.toISOString().slice(0, 10),
    isAllDay: record.isAllDay,
    startTime: toHHmm(record.startTime),
    endTime: toHHmm(record.endTime),
  };
}

// ============================================================
// Public API
// ============================================================

export interface ListOptions {
  page?: number;
  limit?: number;
  status?: number;
}

/** List practices (paginated). */
export async function listPractices(
  options: ListOptions = {},
  injected?: PrismaLike,
): Promise<{ data: PracticeDTO[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const db = client(injected);

  const where: { status?: number } = {};
  if (typeof options.status === 'number') where.status = options.status;

  const [rows, total] = await Promise.all([
    db.clinic.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.clinic.count({ where }),
  ]);

  return {
    data: rows.map(toDTO),
    total,
    page,
    limit,
  };
}

/** Get a single practice by ID. Throws PracticeNotFoundError if missing. */
export async function getPractice(id: string, injected?: PrismaLike): Promise<PracticeDTO> {
  const db = client(injected);
  const row = await db.clinic.findUnique({ where: { id } });
  if (!row) throw new PracticeNotFoundError(id);
  return toDTO(row);
}

/**
 * Update a practice. Validates input via Zod, preserves existing fields
 * (PATCH semantics), and writes an audit log entry.
 */
export async function updatePractice(
  id: string,
  input: unknown,
  options: { actorId?: string | null } = {},
  injected?: PrismaLike,
): Promise<PracticeDTO> {
  const parsed = practiceUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new PracticeValidationError(
      'Invalid practice update',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const patch = parsed.data;
  const db = client(injected);

  const before = await db.clinic.findUnique({ where: { id } });
  if (!before) throw new PracticeNotFoundError(id);

  // Build the column-level update. `extra` merges with existing JSON.
  const existingExtra = (before.extra ?? {}) as Record<string, unknown>;
  const mergedExtra: Record<string, unknown> = { ...existingExtra };
  if (patch.timezone !== undefined) mergedExtra.timezone = patch.timezone;
  if (patch.logoUrl !== undefined) mergedExtra.logoUrl = patch.logoUrl;
  if (patch.businessHours !== undefined) mergedExtra.businessHours = patch.businessHours;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.email !== undefined) data.email = patch.email;
  if (patch.telephoneNo !== undefined) data.telephoneNo = patch.telephoneNo;
  if (patch.address !== undefined) data.address = patch.address;
  if (patch.city !== undefined) data.city = patch.city;
  if (patch.state !== undefined) data.state = patch.state;
  if (patch.country !== undefined) data.country = patch.country;
  if (patch.postalCode !== undefined) data.postalCode = patch.postalCode;
  if (patch.countryCode !== undefined) data.countryCode = patch.countryCode;
  if (patch.countryCallingCode !== undefined) data.countryCallingCode = patch.countryCallingCode;
  if (patch.status !== undefined) data.status = patch.status;
  // Only write extra if it actually changed
  if (Object.keys(mergedExtra).length !== Object.keys(existingExtra).length || JSON.stringify(mergedExtra) !== JSON.stringify(existingExtra)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data.extra = mergedExtra as any;
  }

  const after = await db.clinic.update({ where: { id }, data });
  await logging.audit('practice.update', {
    userId: options.actorId ?? null,
    resource: 'practice',
    resourceId: id,
    metadata: { changedKeys: Object.keys(patch) },
  });
  return toDTO(after);
}

// ============================================================
// Holidays
// ============================================================

/** List all holidays for a practice. Returns [] if the practice has none. */
export async function listHolidays(
  practiceId: string,
  injected?: PrismaLike,
): Promise<HolidayDTO[]> {
  const db = client(injected);
  const practice = await db.clinic.findUnique({ where: { id: practiceId }, select: { id: true } });
  if (!practice) throw new PracticeNotFoundError(practiceId);
  const rows = await db.holiday.findMany({
    where: { moduleType: PRACTICE_MODULE, moduleId: practiceId },
    orderBy: { startDate: 'asc' },
  });
  return rows.map(toHolidayDTO);
}

/** Add a holiday to a practice. */
export async function addHoliday(
  practiceId: string,
  input: unknown,
  options: { actorId?: string | null } = {},
  injected?: PrismaLike,
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

  const db = client(injected);
  const practice = await db.clinic.findUnique({ where: { id: practiceId }, select: { id: true } });
  if (!practice) throw new PracticeNotFoundError(practiceId);

  const created = await db.holiday.create({
    data: {
      moduleType: PRACTICE_MODULE,
      moduleId: practiceId,
      title: data.title,
      startDate: new Date(`${data.startDate}T00:00:00.000Z`),
      endDate: new Date(`${data.endDate}T00:00:00.000Z`),
      isAllDay: data.isAllDay,
      startTime: data.startTime ?? null,
      endTime: data.endTime ?? null,
    },
  });
  await logging.audit('practice.holiday.add', {
    userId: options.actorId ?? null,
    resource: 'holiday',
    resourceId: created.id,
    metadata: { practiceId, title: data.title, startDate: data.startDate, endDate: data.endDate },
  });
  return toHolidayDTO(created);
}

// ============================================================
// Bulk operations
// ============================================================

/** Soft-delete practices by setting status to 0 (inactive). */
export async function bulkDeletePractices(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await prisma.clinic.updateMany({
    where: { id: { in: ids } },
    data: { status: 0 },
  });
  return result.count;
}

/** Set status on multiple practices at once. */
export async function bulkSetPracticeStatus(ids: string[], status: number): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await prisma.clinic.updateMany({
    where: { id: { in: ids } },
    data: { status },
  });
  return result.count;
}

/** Export all practices (optionally filtered by status). */
export async function exportPractices(params: { status?: number }): Promise<unknown[]> {
  const where: { status?: number } = {};
  if (typeof params.status === 'number') where.status = params.status;
  return prisma.clinic.findMany({ where, orderBy: { name: 'asc' } });
}

/** List users associated with a practice via junction tables and ClinicAdmin. */
export async function listPracticeUsers(practiceId: string): Promise<unknown[]> {
  const [doctorMappings, receptionistMappings, patientMappings, admin] = await Promise.all([
    prisma.doctorClinicMapping.findMany({
      where: { clinicId: practiceId },
      select: { doctor: { select: { user: { select: { id: true, email: true, role: true, createdAt: true } } } } },
    }),
    prisma.receptionistClinicMapping.findMany({
      where: { clinicId: practiceId },
      select: { receptionist: { select: { user: { select: { id: true, email: true, role: true, createdAt: true } } } } },
    }),
    prisma.patientClinicMapping.findMany({
      where: { clinicId: practiceId },
      select: { patient: { select: { user: { select: { id: true, email: true, role: true, createdAt: true } } } } },
    }),
    prisma.clinic.findUnique({
      where: { id: practiceId },
      select: { clinicAdmin: { select: { id: true, email: true, role: true, createdAt: true } } },
    }),
  ]);

  const seen = new Set<string>();
  const users: { id: string; email: string; role: string; createdAt: Date }[] = [];

  const add = (u: { id: string; email: string; role: string; createdAt: Date } | null | undefined) => {
    if (!u || seen.has(u.id)) return;
    seen.add(u.id);
    users.push(u);
  };

  doctorMappings.forEach((m) => add(m.doctor.user));
  receptionistMappings.forEach((m) => add(m.receptionist.user));
  patientMappings.forEach((m) => add(m.patient.user));
  if (admin) add(admin.clinicAdmin);

  return users;
}

/** Update the clinic admin for a practice. */
export async function changePracticeAdmin(practiceId: string, newAdminId: string): Promise<void> {
  await prisma.clinic.update({
    where: { id: practiceId },
    data: { clinicAdminId: newAdminId },
  });
}

/** Remove a holiday by ID. Returns true if a row was deleted. */
export async function removeHoliday(
  practiceId: string,
  holidayId: string,
  options: { actorId?: string | null } = {},
  injected?: PrismaLike,
): Promise<boolean> {
  const db = client(injected);
  const existing = await db.holiday.findUnique({ where: { id: holidayId } });
  if (!existing || existing.moduleType !== PRACTICE_MODULE || existing.moduleId !== practiceId) {
    throw new HolidayNotFoundError(holidayId);
  }
  await db.holiday.delete({ where: { id: holidayId } });
  await logging.audit('practice.holiday.remove', {
    userId: options.actorId ?? null,
    resource: 'holiday',
    resourceId: holidayId,
    metadata: { practiceId },
  });
  return true;
}
