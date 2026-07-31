/**
 * Reads for an encounter's clinical records — its history entries and prescriptions.
 *
 * Deliberately narrow. `billing/medical-history.service.ts` and
 * `billing/prescription.service.ts` already read these tables, but as RBAC-scoped,
 * paginated list APIs that join clinic/doctor/patient names for a management screen.
 * The encounter-shaped features (session notes, intervention plans) want the opposite:
 * one encounter's rows, typed, in order, with no scope object and no joins — they
 * authorise through the encounter itself. Rather than widen those services or duplicate
 * them, this adds only the reads that were missing.
 *
 * The writes already live in `encounters.write.ts` and go through the plugin, because
 * KiviCare fires listeners on encounter changes. Reads are direct SQL, as everywhere
 * else.
 *
 * Ids are `number` — `wp_kc_patient_encounters.id` and the row ids beneath it.
 */
import { prisma } from '@/lib/db';
import { HISTORY_TYPE, type HistoryType } from './encounters.write';

export { HISTORY_TYPE };
export type { HistoryType };

/* ------------------------------------------------------------------ */
/* Encounters                                                          */
/* ------------------------------------------------------------------ */

export type WpEncounter = {
  id: number;
  clinicId: number;
  doctorId: number;
  patientId: number;
  appointmentId: number | null;
  description: string | null;
  /** 1 = open, 0 = closed. */
  status: number;
  addedBy: number;
  encounterDate: Date | null;
  createdAt: Date | null;
};

const ENCOUNTER_SELECT = {
  id: true,
  clinicId: true,
  doctorId: true,
  patientId: true,
  appointmentId: true,
  description: true,
  status: true,
  addedBy: true,
  encounterDate: true,
  createdAt: true,
} as const;

type EncounterRow = {
  id: bigint;
  clinicId: bigint;
  doctorId: bigint;
  patientId: bigint;
  appointmentId: bigint | null;
  description: string | null;
  status: number | null;
  addedBy: bigint;
  encounterDate: Date | null;
  createdAt: Date | null;
};

function toEncounter(r: EncounterRow): WpEncounter {
  return {
    id: Number(r.id),
    clinicId: Number(r.clinicId),
    doctorId: Number(r.doctorId),
    patientId: Number(r.patientId),
    appointmentId: r.appointmentId === null ? null : Number(r.appointmentId),
    description: r.description,
    status: Number(r.status ?? 0),
    addedBy: Number(r.addedBy),
    encounterDate: r.encounterDate,
    createdAt: r.createdAt,
  };
}

/**
 * The encounter recording one appointment — the "session note" of that session.
 *
 * KiviCare puts no unique index on `appointment_id`, so duplicates are possible in
 * principle. The lowest id wins, so the answer is at least deterministic and matches
 * whichever row KiviCare's own UI created first.
 */
export async function findEncounterByAppointmentId(
  appointmentId: number,
): Promise<WpEncounter | null> {
  const row = await prisma.kcPatientEncounter.findFirst({
    where: { appointmentId: BigInt(appointmentId) },
    select: ENCOUNTER_SELECT,
    orderBy: { id: 'asc' },
  });
  return row ? toEncounter(row as EncounterRow) : null;
}

export async function findEncounterById(id: number): Promise<WpEncounter | null> {
  const row = await prisma.kcPatientEncounter.findUnique({
    where: { id: BigInt(id) },
    select: ENCOUNTER_SELECT,
  });
  return row ? toEncounter(row as EncounterRow) : null;
}

export type ListEncountersQuery = {
  page: number;
  perPage: number;
  /** Restrict to these clinics. An empty array yields nothing, never everything. */
  clinicIds?: number[];
  doctorId?: number;
  patientId?: number;
  status?: number;
};

export async function listEncounters(
  query: ListEncountersQuery,
): Promise<{ items: WpEncounter[]; total: number }> {
  const where: Record<string, unknown> = {};

  if (query.clinicIds !== undefined) {
    // An access-control filter: "scoped to no clinics" must return nothing.
    where.clinicId =
      query.clinicIds.length === 0
        ? { in: [] }
        : { in: query.clinicIds.map((n) => BigInt(n)) };
  }
  if (query.doctorId !== undefined) where.doctorId = BigInt(query.doctorId);
  if (query.patientId !== undefined) where.patientId = BigInt(query.patientId);
  if (query.status !== undefined) where.status = query.status;

  const perPage = Math.min(100, Math.max(1, Math.trunc(query.perPage)));
  const page = Math.max(1, Math.trunc(query.page));

  const [rows, total] = await Promise.all([
    prisma.kcPatientEncounter.findMany({
      where,
      select: ENCOUNTER_SELECT,
      orderBy: { id: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.kcPatientEncounter.count({ where }),
  ]);

  return { items: (rows as EncounterRow[]).map(toEncounter), total };
}

/* ------------------------------------------------------------------ */
/* Medical history                                                     */
/* ------------------------------------------------------------------ */

export type WpHistoryEntry = {
  id: number;
  encounterId: number;
  patientId: number;
  /**
   * KiviCare's own vocabulary: `problem`, `observation`, `note`. The column is a plain
   * varchar with no constraint, so an add-on can write anything; unrecognised values
   * are surfaced as-is rather than dropped, because hiding a clinician's row would be
   * worse than showing an unfamiliar label.
   */
  type: string;
  title: string;
  addedBy: number;
  isFromTemplate: boolean;
  createdAt: Date | null;
};

function isKnownType(t: string): t is HistoryType {
  return (Object.values(HISTORY_TYPE) as string[]).includes(t);
}

/** True when `type` is one KiviCare itself writes — useful for grouping a UI. */
export function isKnownHistoryType(t: string): boolean {
  return isKnownType(t);
}

export async function listEncounterHistory(
  encounterId: number,
  opts: { type?: HistoryType } = {},
): Promise<WpHistoryEntry[]> {
  const rows = await prisma.kcMedicalHistory.findMany({
    where: {
      encounterId: BigInt(encounterId),
      ...(opts.type ? { type: opts.type } : {}),
    },
    select: {
      id: true,
      encounterId: true,
      patientId: true,
      type: true,
      title: true,
      addedBy: true,
      isFromTemplate: true,
      createdAt: true,
    },
    // Ascending: these read as a narrative, so the order they were written in is the
    // order they should be shown in.
    orderBy: { id: 'asc' },
  });

  return rows.map((r) => ({
    id: Number(r.id),
    encounterId: Number(r.encounterId),
    patientId: Number(r.patientId),
    type: r.type,
    title: r.title ?? '',
    addedBy: Number(r.addedBy),
    isFromTemplate: r.isFromTemplate === 1,
    createdAt: r.createdAt,
  }));
}

/**
 * History entries for several encounters at once.
 *
 * One query for a whole page, so a timeline does not run one lookup per encounter.
 * An empty list returns nothing rather than everything.
 */
export async function listHistoryForEncounters(
  encounterIds: number[],
): Promise<Map<number, WpHistoryEntry[]>> {
  const out = new Map<number, WpHistoryEntry[]>();
  if (encounterIds.length === 0) return out;

  const rows = await prisma.kcMedicalHistory.findMany({
    where: { encounterId: { in: encounterIds.map((n) => BigInt(n)) } },
    select: {
      id: true,
      encounterId: true,
      patientId: true,
      type: true,
      title: true,
      addedBy: true,
      isFromTemplate: true,
      createdAt: true,
    },
    orderBy: { id: 'asc' },
  });

  for (const r of rows) {
    const key = Number(r.encounterId);
    const entry: WpHistoryEntry = {
      id: Number(r.id),
      encounterId: key,
      patientId: Number(r.patientId),
      type: r.type,
      title: r.title ?? '',
      addedBy: Number(r.addedBy),
      isFromTemplate: r.isFromTemplate === 1,
      createdAt: r.createdAt,
    };
    const list = out.get(key);
    if (list) list.push(entry);
    else out.set(key, [entry]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Prescriptions                                                       */
/* ------------------------------------------------------------------ */

export type WpPrescription = {
  id: number;
  encounterId: number;
  patientId: number;
  /** What was prescribed. KiviCare labels this "name"; it is free text. */
  name: string;
  frequency: string | null;
  duration: string | null;
  instruction: string | null;
  addedBy: number;
  isFromTemplate: boolean;
  createdAt: Date | null;
};

const PRESCRIPTION_SELECT = {
  id: true,
  encounterId: true,
  patientId: true,
  name: true,
  frequency: true,
  duration: true,
  instruction: true,
  addedBy: true,
  isFromTemplate: true,
  createdAt: true,
} as const;

type PrescriptionRow = {
  id: bigint;
  encounterId: bigint;
  patientId: bigint;
  name: string | null;
  frequency: string | null;
  duration: string | null;
  instruction: string | null;
  addedBy: bigint;
  isFromTemplate: number | null;
  createdAt: Date | null;
};

function toPrescription(r: PrescriptionRow): WpPrescription {
  return {
    id: Number(r.id),
    encounterId: Number(r.encounterId),
    patientId: Number(r.patientId),
    name: r.name ?? '',
    // Empty strings are normalised to null: KiviCare writes '' for an unset field, and
    // a caller checking `frequency !== null` should not be fooled by it.
    frequency: r.frequency ? r.frequency : null,
    duration: r.duration ? r.duration : null,
    instruction: r.instruction ? r.instruction : null,
    addedBy: Number(r.addedBy),
    isFromTemplate: r.isFromTemplate === 1,
    createdAt: r.createdAt,
  };
}

export async function listEncounterPrescriptions(
  encounterId: number,
): Promise<WpPrescription[]> {
  const rows = await prisma.kcPrescription.findMany({
    where: { encounterId: BigInt(encounterId) },
    select: PRESCRIPTION_SELECT,
    orderBy: { id: 'asc' },
  });
  return (rows as PrescriptionRow[]).map(toPrescription);
}

export async function findPrescriptionById(id: number): Promise<WpPrescription | null> {
  const row = await prisma.kcPrescription.findUnique({
    where: { id: BigInt(id) },
    select: PRESCRIPTION_SELECT,
  });
  return row ? toPrescription(row as PrescriptionRow) : null;
}

/**
 * Prescriptions for several encounters at once — the batching pair of
 * `listHistoryForEncounters`, for the same reason.
 */
export async function listPrescriptionsForEncounters(
  encounterIds: number[],
): Promise<Map<number, WpPrescription[]>> {
  const out = new Map<number, WpPrescription[]>();
  if (encounterIds.length === 0) return out;

  const rows = await prisma.kcPrescription.findMany({
    where: { encounterId: { in: encounterIds.map((n) => BigInt(n)) } },
    select: PRESCRIPTION_SELECT,
    orderBy: { id: 'asc' },
  });

  for (const raw of rows as PrescriptionRow[]) {
    const p = toPrescription(raw);
    const list = out.get(p.encounterId);
    if (list) list.push(p);
    else out.set(p.encounterId, [p]);
  }
  return out;
}
