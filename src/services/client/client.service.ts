/**
 * Client service — backed by WordPress, not a `clients` table.
 *
 * A client IS a `wp_users` row carrying the `kiviCare_patient` capability. The previous
 * implementation read and wrote a `clients` shadow table which, on the restored
 * production copy, held **0 rows while 752 real patients existed in `wp_users`** — so
 * this endpoint was blind to every actual patient. See
 * docs/architecture/shadow-tables-audit.md and client-service-migration.md.
 *
 * Split of responsibilities:
 *  - Reads   → `repositories/wp/patients.repo.ts` (direct SQL, as `billing/*` does)
 *  - Writes  → `repositories/wp/patients.write.ts` → praktiqu-endpoint plugin REST, so
 *              KiviCare's `kc_patient_save` listeners fire (welcome email, Pro custom
 *              fields). Decision D1.
 *  - Scoping → `resolveKcActor` maps the JWT actor to `wp_users.ID` + a clinic id, the
 *              same bridge the billing services already use.
 *
 * IDs are `number` (`wp_users.ID`). That is the D2 breaking change — no cuid, no shim.
 */

import { prisma } from '@/lib/db';
import { logging } from '@/lib/logging';
import { resolveKcActor, type KcActor } from '@/services/billing/kc-actor';
import {
  CLIENT_STATUS,
  findPatientById,
  listPatients,
  type ClientStatus,
  type WpPatient,
} from '@/repositories/wp/patients.repo';
import { createPatient, updatePatient } from '@/repositories/wp/patients.write';
import { WpEndpointError } from '@/lib/wp-endpoint';
import { type CreateClientInput, type ListClientsQuery, type UpdateClientInput } from './validation';
import type { Client, ClientDetail, ClientListItem, PaginatedResponse } from '@/types/client';
import type { Actor as AuthActor } from '@/lib/auth';

export type Actor = AuthActor;

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class ClientServiceError extends Error {
  status: number;
  code: string;
  fields?: Array<{ field: string; message: string }>;
  constructor(
    message: string,
    options: { status?: number; code?: string; fields?: Array<{ field: string; message: string }> } = {},
  ) {
    super(message);
    this.name = 'ClientServiceError';
    this.status = options.status ?? 500;
    this.code = options.code ?? 'internal_error';
    this.fields = options.fields;
  }
}

export class InvalidStatusTransitionError extends ClientServiceError {
  constructor(from: ClientStatus, to: ClientStatus) {
    super(`Cannot transition client status from ${from} to ${to}`, {
      status: 400,
      code: 'invalid_status_transition',
      fields: [{ field: 'status', message: `Cannot transition from ${from} to ${to}` }],
    });
    this.name = 'InvalidStatusTransitionError';
  }
}

const VALID_TRANSITIONS: Record<ClientStatus, ClientStatus[]> = {
  ACTIVE: [CLIENT_STATUS.INACTIVE, CLIENT_STATUS.ARCHIVED],
  INACTIVE: [CLIENT_STATUS.ACTIVE, CLIENT_STATUS.ARCHIVED],
  // An archived client is restored by reactivating, never re-archived.
  ARCHIVED: [CLIENT_STATUS.ACTIVE],
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function audit(event: string, actor: Actor, payload: Record<string, unknown>): Promise<void> {
  await logging.audit(event, {
    userId: actor.id,
    action: event,
    resource: 'client',
    metadata: { actorRole: actor.role, ...payload },
  });
}

/** Map a plugin transport error onto our error shape, preserving its status. */
function rethrowWpError(err: unknown): never {
  if (err instanceof WpEndpointError) {
    throw new ClientServiceError(err.message, {
      status: err.status >= 400 && err.status < 600 ? err.status : 502,
      code: err.status === 409 ? 'email_conflict' : 'wp_write_failed',
    });
  }
  throw err;
}

function fullName(p: WpPatient): string {
  const composed = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  // display_name is what KiviCare falls back to when first/last are absent.
  return composed || p.displayName || p.email;
}

function toClient(p: WpPatient): Client {
  return {
    id: Number(p.id),
    clinicId: p.clinicId === null ? null : Number(p.clinicId),
    uniqueClientId: p.patientUniqueId,
    fullName: fullName(p),
    email: p.email,
    mobileNumber: p.mobileNumber,
    dateOfBirth: p.dateOfBirth,
    gender: p.gender,
    address: p.address,
    emergencyContact: p.emergencyContact,
    notes: p.notes,
    status: p.status,
    createdAt: p.registeredAt,
  };
}

/** A client's sessions are their KiviCare appointments. */
async function sessionCountFor(wpUserId: bigint): Promise<number> {
  return prisma.kcAppointment.count({ where: { patientId: wpUserId } });
}

/** One grouped query for a page of clients, rather than N counts. */
async function sessionCountsFor(ids: bigint[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.kcAppointment.groupBy({
    by: ['patientId'],
    where: { patientId: { in: ids } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.patientId.toString(), r._count._all]));
}

/**
 * Clinics the actor may see; `undefined` means unrestricted (SUPER_ADMIN).
 *
 * A scoped actor with no clinic yields `[]`, which the repository honours as
 * "no results" — never "all results".
 */
function visibleClinics(kc: KcActor): bigint[] | undefined {
  if (kc.actor.role === 'SUPER_ADMIN') return undefined;
  return kc.clinicId === null ? [] : [kc.clinicId];
}

async function loadForActor(kc: KcActor, id: number): Promise<WpPatient> {
  const patient = await findPatientById(BigInt(id));
  if (!patient) {
    throw new ClientServiceError('Client not found', { status: 404, code: 'not_found' });
  }
  enforceClientReadAccess(kc, patient);
  return patient;
}

/* ------------------------------------------------------------------ */
/* Access control                                                      */
/* ------------------------------------------------------------------ */

export function enforceClientReadAccess(kc: KcActor, patient: WpPatient): void {
  const { role } = kc.actor;

  if (role === 'SUPER_ADMIN') return;

  if (role === 'CLIENT') {
    // Compare WordPress ids: the JWT subject is a cuid in the auth mirror, which is
    // not the patient id.
    if (patient.id !== kc.wpUserId) {
      throw new ClientServiceError('Forbidden: not your profile', { status: 403, code: 'forbidden' });
    }
    return;
  }

  if (role === 'CLINIC_ADMIN' || role === 'RECEPTIONIST' || role === 'PROFESSIONAL') {
    if (kc.clinicId === null || patient.clinicId !== kc.clinicId) {
      throw new ClientServiceError('Forbidden: client is not in your clinic', {
        status: 403,
        code: 'forbidden',
      });
    }
    return;
  }

  throw new ClientServiceError('Forbidden', { status: 403, code: 'forbidden' });
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export interface CreateClientArgs {
  actor: Actor;
  input: CreateClientInput;
  /** WordPress clinic id. Required for SUPER_ADMIN; derived from the actor otherwise. */
  clinicId?: number;
}

export async function createClient(args: CreateClientArgs): Promise<ClientDetail> {
  const { actor, input } = args;

  if (!['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST'].includes(actor.role)) {
    throw new ClientServiceError('Insufficient permission to register clients', {
      status: 403,
      code: 'forbidden',
    });
  }

  const kc = await resolveKcActor(actor);
  const clinicId =
    actor.role === 'SUPER_ADMIN' ? args.clinicId : Number(kc.clinicId ?? args.clinicId ?? 0);

  if (!clinicId || clinicId <= 0) {
    throw new ClientServiceError('clinicId is required', {
      status: 400,
      code: 'missing_clinic_id',
      fields: [{ field: 'clinicId', message: 'clinicId is required' }],
    });
  }

  const [firstName, ...rest] = input.fullName.trim().split(/\s+/);

  let created;
  try {
    // The plugin owns email uniqueness and the wp_usermeta layout, and fires
    // kc_patient_save — which sends the welcome email carrying the generated password.
    created = await createPatient({
      email: input.email,
      firstName: firstName ?? input.fullName,
      lastName: rest.join(' '),
      contactNumber: input.mobileNumber,
      gender: input.gender,
      dateOfBirth: input.dateOfBirth,
      address: input.address ?? undefined,
      clinicId,
      status: CLIENT_STATUS.ACTIVE,
    });
  } catch (err) {
    rethrowWpError(err);
  }

  await audit('client.created', actor, { clientId: created.id, clinicId });

  // Read back rather than echoing the request: the plugin normalises the profile, and
  // returning our own input would hide any divergence.
  const patient = await findPatientById(BigInt(created.id));
  if (!patient) {
    throw new ClientServiceError('Client was created but could not be read back', {
      status: 502,
      code: 'readback_failed',
    });
  }
  return { ...toClient(patient), sessionCount: 0 };
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export interface GetClientArgs {
  actor: Actor;
  id: number;
}

export async function getClient(args: GetClientArgs): Promise<ClientDetail> {
  const kc = await resolveKcActor(args.actor);
  const patient = await loadForActor(kc, args.id);
  return { ...toClient(patient), sessionCount: await sessionCountFor(patient.id) };
}

export interface ListClientsArgs {
  actor: Actor;
  query: ListClientsQuery;
}

export async function listClients(args: ListClientsArgs): Promise<PaginatedResponse<ClientListItem>> {
  const { actor, query } = args;
  const kc = await resolveKcActor(actor);

  const { items, total } = await listPatients({
    page: query.page,
    perPage: query.limit,
    search: query.search,
    clinicIds: visibleClinics(kc),
    statuses: query.status ? [query.status as ClientStatus] : undefined,
  });

  const counts = await sessionCountsFor(items.map((p) => p.id));

  const data: ClientListItem[] = items.map((p) => ({
    id: Number(p.id),
    uniqueClientId: p.patientUniqueId,
    fullName: fullName(p),
    email: p.email,
    mobileNumber: p.mobileNumber,
    status: p.status,
    sessionCount: counts.get(p.id.toString()) ?? 0,
    createdAt: p.registeredAt,
  }));

  return {
    data,
    pagination: {
      currentPage: query.page,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
      totalItems: total,
      itemsPerPage: query.limit,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Update                                                              */
/* ------------------------------------------------------------------ */

const STAFF_EDITABLE: ReadonlySet<string> = new Set([
  'fullName',
  'mobileNumber',
  'address',
  'emergencyContact',
  'notes',
]);
const CLIENT_SELF_EDITABLE: ReadonlySet<string> = new Set([
  'mobileNumber',
  'address',
  'emergencyContact',
  'notes',
]);
const SUPER_ADMIN_EDITABLE: ReadonlySet<string> = new Set([
  'fullName',
  'email',
  'mobileNumber',
  'dateOfBirth',
  'gender',
  'address',
  'emergencyContact',
  'notes',
]);

export interface UpdateClientArgs {
  actor: Actor;
  id: number;
  input: UpdateClientInput;
}

export async function updateClient(args: UpdateClientArgs): Promise<ClientDetail> {
  const { actor, id, input } = args;
  const kc = await resolveKcActor(actor);
  await loadForActor(kc, id);

  const allowed =
    actor.role === 'SUPER_ADMIN'
      ? SUPER_ADMIN_EDITABLE
      : actor.role === 'CLIENT'
        ? CLIENT_SELF_EDITABLE
        : STAFF_EDITABLE;

  const rejected = Object.keys(input).filter((k) => !allowed.has(k));
  if (rejected.length > 0) {
    throw new ClientServiceError(`Not permitted to edit: ${rejected.join(', ')}`, {
      status: 403,
      code: 'forbidden_field',
      fields: rejected.map((f) => ({ field: f, message: 'Not editable by your role' })),
    });
  }

  const payload: Parameters<typeof updatePatient>[1] = {};
  if (input.fullName !== undefined) {
    const [first, ...rest] = input.fullName.trim().split(/\s+/);
    payload.firstName = first;
    payload.lastName = rest.join(' ');
  }
  if (input.email !== undefined) payload.email = input.email;
  if (input.mobileNumber !== undefined) payload.contactNumber = input.mobileNumber;
  if (input.dateOfBirth !== undefined) payload.dateOfBirth = input.dateOfBirth;
  if (input.gender !== undefined) payload.gender = input.gender;
  if (input.address !== undefined) payload.address = input.address ?? '';
  if (input.emergencyContact !== undefined) payload.emergencyContact = input.emergencyContact ?? '';
  if (input.notes !== undefined) payload.notes = input.notes ?? '';

  if (Object.keys(payload).length > 0) {
    try {
      await updatePatient(id, payload);
    } catch (err) {
      rethrowWpError(err);
    }
  }

  await audit('client.updated', actor, { clientId: id, fields: Object.keys(input) });

  const patient = await findPatientById(BigInt(id));
  if (!patient) {
    throw new ClientServiceError('Client not found', { status: 404, code: 'not_found' });
  }
  return { ...toClient(patient), sessionCount: await sessionCountFor(patient.id) };
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export interface SetStatusArgs {
  actor: Actor;
  id: number;
  to: ClientStatus;
}

export async function setStatus(args: SetStatusArgs): Promise<ClientDetail> {
  const { actor, id, to } = args;
  if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'CLINIC_ADMIN') {
    throw new ClientServiceError('Only SUPER_ADMIN or CLINIC_ADMIN can change client status', {
      status: 403,
      code: 'forbidden',
    });
  }

  const kc = await resolveKcActor(actor);
  const existing = await loadForActor(kc, id);

  if (!VALID_TRANSITIONS[existing.status].includes(to)) {
    throw new InvalidStatusTransitionError(existing.status, to);
  }

  try {
    await updatePatient(id, { status: to });
  } catch (err) {
    rethrowWpError(err);
  }

  await audit('client.status_changed', actor, { clientId: id, from: existing.status, to });

  const patient = await findPatientById(BigInt(id));
  if (!patient) {
    throw new ClientServiceError('Client not found', { status: 404, code: 'not_found' });
  }
  return { ...toClient(patient), sessionCount: await sessionCountFor(patient.id) };
}

/**
 * Archive (soft-delete) — DELETE /clients/:id.
 * Precondition: the client must already be INACTIVE.
 */
export interface ArchiveClientArgs {
  actor: Actor;
  id: number;
}

export async function archiveClient(args: ArchiveClientArgs): Promise<ClientDetail> {
  const kc = await resolveKcActor(args.actor);
  const existing = await loadForActor(kc, args.id);

  if (existing.status !== CLIENT_STATUS.INACTIVE) {
    throw new InvalidStatusTransitionError(existing.status, CLIENT_STATUS.ARCHIVED);
  }
  return setStatus({ actor: args.actor, id: args.id, to: CLIENT_STATUS.ARCHIVED });
}

/* ------------------------------------------------------------------ */
/* Bulk                                                                */
/* ------------------------------------------------------------------ */

/**
 * Bulk status change.
 *
 * Sequential, not parallel: each call is an HTTP round trip that fires KiviCare hooks,
 * and firing dozens concurrently risks overwhelming the site and interleaving
 * notification side effects. Individual failures are counted and logged rather than
 * thrown, so one bad id cannot abandon the rest half-applied.
 */
async function bulkApplyStatus(ids: number[], status: ClientStatus): Promise<number> {
  let applied = 0;
  for (const id of ids) {
    try {
      await updatePatient(id, { status });
      applied += 1;
    } catch (err) {
      await logging.warn('Bulk client status change failed for one id', {
        metadata: { clientId: id, status, error: String(err) },
      });
    }
  }
  return applied;
}

export async function bulkArchiveClients(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  return bulkApplyStatus(ids, CLIENT_STATUS.ARCHIVED);
}

export async function bulkSetClientStatus(ids: number[], status: ClientStatus): Promise<number> {
  if (ids.length === 0) return 0;
  return bulkApplyStatus(ids, status);
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export interface ClientExportParams {
  clinicId?: number;
  status?: ClientStatus;
}

/** Page size for the export sweep. */
const EXPORT_PAGE = 100;

export async function exportClients(params: ClientExportParams): Promise<Client[]> {
  const out: Client[] = [];
  for (let page = 1; ; page += 1) {
    const { items, total } = await listPatients({
      page,
      perPage: EXPORT_PAGE,
      clinicIds: params.clinicId ? [BigInt(params.clinicId)] : undefined,
      statuses: params.status ? [params.status] : undefined,
    });
    out.push(...items.map(toClient));
    // `items.length === 0` also guards against a total that shrinks mid-sweep.
    if (items.length === 0 || out.length >= total) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

export interface ClientStatistics {
  totalSessions: number;
  lastSessionAt: Date | null;
}

export async function getClientStatistics(clientId: number): Promise<ClientStatistics> {
  const patientId = BigInt(clientId);

  const [totalSessions, last] = await Promise.all([
    prisma.kcAppointment.count({ where: { patientId } }),
    prisma.kcAppointment.findFirst({
      where: { patientId },
      orderBy: [{ appointmentStartDate: 'desc' }, { id: 'desc' }],
      select: { appointmentStartDate: true },
    }),
  ]);

  return { totalSessions, lastSessionAt: last?.appointmentStartDate ?? null };
}
