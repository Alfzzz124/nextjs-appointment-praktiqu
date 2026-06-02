/**
 * Client service — Feature 004.
 *
 * Responsibilities:
 *  - CRUD for Client records
 *  - Unique ID generation (delegates to lib/unique-id.ts)
 *  - Status transitions (ACTIVE/INACTIVE/ARCHIVED) with audit log
 *  - Practice-scoped listing with search + filter
 *  - Email uniqueness check (per-practice, ACTIVE clients only)
 *  - All state changes emit audit log entries (FR-011)
 *
 * Design notes:
 *  - This service is the only place that writes to the Client table. The API
 *    route is a thin RBAC + validation layer over it.
 *  - Soft-delete via `status = ARCHIVED`. The row is preserved so historical
 *    sessions keep a stable FK.
 *  - All public methods take an `actor` (User) for RBAC + audit context.
 */

import { ClientStatus, Gender, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { generateUniqueClientId } from '@/lib/unique-id';
import { logging } from '@/lib/logging';
import {
  type CreateClientInput,
  type ListClientsQuery,
  type UpdateClientInput,
} from './validation';
import type {
  Client,
  ClientDetail,
  ClientListItem,
  PaginatedResponse,
} from '@/types/client';

export type Actor = {
  id: string;
  role: 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'PROFESSIONAL' | 'RECEPTIONIST' | 'CLIENT';
  practiceId: string | null;
};

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

function resolvePracticeId(actor: Actor, requested?: string): string {
  if (actor.role === 'SUPER_ADMIN') {
    if (!requested) {
      throw new ClientServiceError('practiceId is required for SUPER_ADMIN', {
        status: 400,
        code: 'missing_practice_id',
      });
    }
    return requested;
  }
  if (!actor.practiceId) {
    throw new ClientServiceError('Actor has no practice association', {
      status: 403,
      code: 'no_practice',
    });
  }
  return actor.practiceId;
}

function buildClientDetail(client: Client, sessionCount: number): ClientDetail {
  return { ...client, sessionCount };
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export interface CreateClientArgs {
  actor: Actor;
  input: CreateClientInput;
  /** Required for SUPER_ADMIN; ignored for other roles. */
  practiceId?: string;
  /** Override for tests. */
  generateId?: typeof generateUniqueClientId;
  /** Pre-existing User record (optional — if absent, will be created). */
  userId?: string;
}

export async function createClient(args: CreateClientArgs): Promise<ClientDetail> {
  const { actor, input } = args;
  const practiceId = resolvePracticeId(actor, args.practiceId);

  // RBAC: only SUPER_ADMIN, CLINIC_ADMIN, RECEPTIONIST can register.
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST'].includes(actor.role)) {
    throw new ClientServiceError('Insufficient permission to register clients', {
      status: 403,
      code: 'forbidden',
    });
  }

  // Email uniqueness check (per practice, ACTIVE clients only — FR-012).
  const existing = await prisma.client.findFirst({
    where: { practiceId, email: input.email, status: { not: ClientStatus.ARCHIVED } },
    select: { id: true },
  });
  if (existing) {
    throw new ClientServiceError('Email already exists in this practice', {
      status: 409,
      code: 'email_conflict',
      fields: [{ field: 'email', message: 'Email already exists in this practice' }],
    });
  }

  // Generate unique ID (atomic via transaction — see lib/unique-id.ts).
  const generateFn = args.generateId ?? generateUniqueClientId;
  const uniqueClientId = await generateFn({ practiceId });

  // Provision (or reuse) the WordPress user record. In dev we may not have
  // a real WP integration; fall back to creating a Prisma User row.
  const userId = args.userId ?? await provisionWordPressUser(input);

  // Create client. If a race produces a duplicate uniqueClientId, retry once.
  let client: Client | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      client = await prisma.client.create({
        data: {
          userId,
          practiceId,
          uniqueClientId,
          fullName: input.fullName,
          email: input.email,
          mobileNumber: input.mobileNumber,
          dateOfBirth: new Date(input.dateOfBirth),
          gender: input.gender as Gender,
          address: input.address ?? null,
          emergencyContact: input.emergencyContact ?? null,
          notes: input.notes ?? null,
          status: ClientStatus.ACTIVE,
        },
      });
      break;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        attempt === 0
      ) {
        // Race: another writer used the same ID. Regenerate and retry.
        const next = await generateFn({ practiceId });
        // Reassign in closure
        // eslint-disable-next-line no-param-reassign
        (client as unknown) = null;
        // Re-create with new ID
        const retry = await prisma.client.create({
          data: {
            userId,
            practiceId,
            uniqueClientId: next,
            fullName: input.fullName,
            email: input.email,
            mobileNumber: input.mobileNumber,
            dateOfBirth: new Date(input.dateOfBirth),
            gender: input.gender as Gender,
            address: input.address ?? null,
            emergencyContact: input.emergencyContact ?? null,
            notes: input.notes ?? null,
            status: ClientStatus.ACTIVE,
          },
        });
        client = retry;
        break;
      }
      throw err;
    }
  }

  if (!client) {
    throw new ClientServiceError('Failed to create client', {
      status: 500,
      code: 'create_failed',
    });
  }

  await audit('client.created', actor, {
    clientId: client.id,
    practiceId: client.practiceId,
    uniqueClientId: client.uniqueClientId,
  });

  return buildClientDetail(client, 0);
}

/**
 * Provision a WordPress user account and return its PraktiQU user id.
 *
 * In production this calls the praktiqu-auth WP plugin REST endpoint to
 * create the WP user. In dev (or when WP is unavailable) it falls back to
 * creating a Prisma User row with the kiviCare_patient role.
 */
async function provisionWordPressUser(input: CreateClientInput): Promise<string> {
  const wpEndpoint = process.env.WORDPRESS_URL;
  const token = process.env.WORDPRESS_SERVICE_TOKEN;
  if (wpEndpoint && token) {
    try {
      const res = await fetch(`${wpEndpoint}/wp-json/praktiqu/v1/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PraktiQU-Service-Token': token,
        },
        body: JSON.stringify({
          email: input.email,
          displayName: input.fullName,
          role: 'kiviCare_patient',
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { userId?: string };
        if (data.userId) {
          return upsertUserRow(input, data.userId);
        }
      }
    } catch (err) {
      await logging.warn('WP user provisioning failed, falling back to local user', {
        metadata: { email: input.email, error: String(err) },
      });
    }
  }

  return upsertUserRow(input, null);
}

async function upsertUserRow(input: CreateClientInput, wpUserId: string | null): Promise<string> {
  const [firstName, ...rest] = input.fullName.trim().split(/\s+/);
  const lastName = rest.join(' ') || firstName;
  const username = input.email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) return existing.id;

  const user = await prisma.user.create({
    data: {
      email: input.email,
      username: username || `client_${Date.now()}`,
      firstName: firstName ?? input.fullName,
      lastName,
      displayName: input.fullName,
      role: 'CLIENT',
      wpUserId: wpUserId ? BigInt(wpUserId) : null,
      wpRole: 'kiviCare_patient',
    },
  });
  return user.id;
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export interface GetClientArgs {
  actor: Actor;
  id: string;
}

export async function getClient(args: GetClientArgs): Promise<ClientDetail> {
  const { actor, id } = args;
  const client = await prisma.client.findUnique({
    where: { id },
  });
  if (!client) {
    throw new ClientServiceError('Client not found', { status: 404, code: 'not_found' });
  }

  enforceClientReadAccess(actor, client);

  const sessionCount = await prisma.appointment.count({ where: { patient: { userId: client.userId } } });
  return buildClientDetail(client, sessionCount);
}

export function enforceClientReadAccess(actor: Actor, client: Client): void {
  if (actor.role === 'SUPER_ADMIN') return;
  if (actor.role === 'CLINIC_ADMIN' || actor.role === 'RECEPTIONIST') {
    if (client.practiceId !== actor.practiceId) {
      throw new ClientServiceError('Forbidden: client is not in your practice', {
        status: 403,
        code: 'forbidden',
      });
    }
    return;
  }
  if (actor.role === 'CLIENT') {
    if (client.userId !== actor.id) {
      throw new ClientServiceError('Forbidden: not your profile', {
        status: 403,
        code: 'forbidden',
      });
    }
    return;
  }
  if (actor.role === 'PROFESSIONAL') {
    // Service-layer check (full RBAC in access-control.ts). Throws if not allowed.
    // Keep this synchronous: we only assert role here, not data access.
    if (client.practiceId !== actor.practiceId) {
      throw new ClientServiceError('Forbidden: professional access denied', {
        status: 403,
        code: 'forbidden',
      });
    }
    return;
  }
  throw new ClientServiceError('Forbidden', { status: 403, code: 'forbidden' });
}

/* ------------------------------------------------------------------ */
/* Update                                                              */
/* ------------------------------------------------------------------ */

export interface UpdateClientArgs {
  actor: Actor;
  id: string;
  input: UpdateClientInput;
}

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

export async function updateClient(args: UpdateClientArgs): Promise<ClientDetail> {
  const { actor, id } = args;
  const existing = await prisma.client.findUnique({ where: { id } });
  if (!existing) {
    throw new ClientServiceError('Client not found', { status: 404, code: 'not_found' });
  }

  // RBAC + field restrictions
  const submittedKeys = Object.keys(args.input);
  let allowedKeys: ReadonlySet<string>;
  if (actor.role === 'SUPER_ADMIN') {
    allowedKeys = new Set([
      'fullName',
      'email',
      'mobileNumber',
      'dateOfBirth',
      'gender',
      'address',
      'emergencyContact',
      'notes',
    ]);
  } else if (actor.role === 'CLINIC_ADMIN') {
    if (existing.practiceId !== actor.practiceId) {
      throw new ClientServiceError('Forbidden', { status: 403, code: 'forbidden' });
    }
    allowedKeys = STAFF_EDITABLE;
  } else if (actor.role === 'CLIENT') {
    if (existing.userId !== actor.id) {
      throw new ClientServiceError('Forbidden', { status: 403, code: 'forbidden' });
    }
    allowedKeys = CLIENT_SELF_EDITABLE;
  } else {
    throw new ClientServiceError('Forbidden', { status: 403, code: 'forbidden' });
  }

  const forbidden = submittedKeys.filter((k) => !allowedKeys.has(k));
  if (forbidden.length > 0) {
    throw new ClientServiceError('One or more fields are read-only for your role', {
      status: 403,
      code: 'read_only_field',
      fields: forbidden.map((f) => ({ field: f, message: 'This field is read-only' })),
    });
  }

  // Email change uniqueness re-check.
  if (args.input.email && args.input.email !== existing.email) {
    const conflict = await prisma.client.findFirst({
      where: {
        practiceId: existing.practiceId,
        email: args.input.email,
        status: { not: ClientStatus.ARCHIVED },
        NOT: { id: existing.id },
      },
      select: { id: true },
    });
    if (conflict) {
      throw new ClientServiceError('Email already exists in this practice', {
        status: 409,
        code: 'email_conflict',
        fields: [{ field: 'email', message: 'Email already exists in this practice' }],
      });
    }
  }

  // Build the patch — only forward allowed keys.
  const data: Prisma.ClientUpdateInput = {};
  if (args.input.fullName !== undefined) data.fullName = args.input.fullName;
  if (args.input.email !== undefined) data.email = args.input.email;
  if (args.input.mobileNumber !== undefined) data.mobileNumber = args.input.mobileNumber;
  if (args.input.dateOfBirth !== undefined) data.dateOfBirth = new Date(args.input.dateOfBirth);
  if (args.input.gender !== undefined) data.gender = args.input.gender as Gender;
  if (args.input.address !== undefined) data.address = args.input.address ?? null;
  if (args.input.emergencyContact !== undefined) data.emergencyContact = args.input.emergencyContact ?? null;
  if (args.input.notes !== undefined) data.notes = args.input.notes ?? null;

  const before = { ...existing };
  const updated = await prisma.client.update({ where: { id }, data });
  const sessionCount = await prisma.appointment.count({
    where: { patient: { userId: updated.userId } },
  });

  await audit('client.updated', actor, {
    clientId: updated.id,
    before: diff(before, updated),
    after: diff(before, updated),
  });

  return buildClientDetail(updated, sessionCount);
}

function diff(before: Client, after: Client): Record<string, { from: unknown; to: unknown }> {
  const result: Record<string, { from: unknown; to: unknown }> = {};
  const keys: Array<keyof Client> = [
    'fullName',
    'email',
    'mobileNumber',
    'dateOfBirth',
    'gender',
    'address',
    'emergencyContact',
    'notes',
  ];
  for (const k of keys) {
    if (!Object.is(before[k], after[k])) {
      result[k as string] = { from: before[k], to: after[k] };
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

const VALID_TRANSITIONS: Record<ClientStatus, ReadonlyArray<ClientStatus>> = {
  ACTIVE: ['INACTIVE'],
  INACTIVE: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: ['ACTIVE'],
};

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

export interface SetStatusArgs {
  actor: Actor;
  id: string;
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

  const existing = await prisma.client.findUnique({ where: { id } });
  if (!existing) {
    throw new ClientServiceError('Client not found', { status: 404, code: 'not_found' });
  }
  if (actor.role === 'CLINIC_ADMIN' && existing.practiceId !== actor.practiceId) {
    throw new ClientServiceError('Forbidden', { status: 403, code: 'forbidden' });
  }
  if (!VALID_TRANSITIONS[existing.status].includes(to)) {
    throw new InvalidStatusTransitionError(existing.status, to);
  }

  const updated = await prisma.client.update({ where: { id }, data: { status: to } });
  const sessionCount = await prisma.appointment.count({
    where: { patient: { userId: updated.userId } },
  });

  await audit('client.status_changed', actor, {
    clientId: updated.id,
    from: existing.status,
    to: updated.status,
  });

  return buildClientDetail(updated, sessionCount);
}

/**
 * Archive (soft-delete) — DELETE /clients/:id.
 *
 * Precondition: client must be INACTIVE. ACTIVE clients must be deactivated
 * first.
 */
export interface ArchiveClientArgs {
  actor: Actor;
  id: string;
}

export async function archiveClient(args: ArchiveClientArgs): Promise<ClientDetail> {
  const { actor, id } = args;
  if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'CLINIC_ADMIN') {
    throw new ClientServiceError('Only SUPER_ADMIN or CLINIC_ADMIN can archive clients', {
      status: 403,
      code: 'forbidden',
    });
  }
  const existing = await prisma.client.findUnique({ where: { id } });
  if (!existing) {
    throw new ClientServiceError('Client not found', { status: 404, code: 'not_found' });
  }
  if (actor.role === 'CLINIC_ADMIN' && existing.practiceId !== actor.practiceId) {
    throw new ClientServiceError('Forbidden', { status: 403, code: 'forbidden' });
  }
  if (existing.status === ClientStatus.ACTIVE) {
    throw new ClientServiceError('Cannot archive ACTIVE client — deactivate first', {
      status: 422,
      code: 'archive_active_forbidden',
      fields: [{ field: 'status', message: 'Deactivate the client before archiving' }],
    });
  }
  return setStatus({ actor, id, to: ClientStatus.ARCHIVED });
}

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

export interface ListClientsArgs {
  actor: Actor;
  query: ListClientsQuery;
}

export async function listClients(args: ListClientsArgs): Promise<PaginatedResponse<ClientListItem>> {
  const { actor, query } = args;
  const practiceFilter =
    actor.role === 'SUPER_ADMIN' ? {} : { practiceId: actor.practiceId ?? '_none_' };

  // If actor is PROFESSIONAL, restrict to clients they have had sessions with.
  // (data-model.md BR-10.01). The API may opt to use a dedicated endpoint
  // for professionals; for v1 we still allow the same list.
  const where: Prisma.ClientWhereInput = { ...practiceFilter };
  if (query.status) where.status = query.status;
  if (query.search) {
    where.OR = [
      { fullName: { contains: query.search } },
      { mobileNumber: { startsWith: query.search } },
    ];
  }

  const [items, totalItems] = await Promise.all([
    prisma.client.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.client.count({ where }),
  ]);

  // Resolve session counts in one round-trip.
  const userIds = items.map((c) => c.userId);
  const counts = userIds.length
    ? await prisma.appointment.groupBy({
        by: ['patientId'],
        where: { patient: { userId: { in: userIds } } },
        _count: { _all: true },
      })
    : [];
  const countByUser = new Map<string, number>();
  for (const c of counts) {
    // We have patientId, but we keyed by userId. Resolve.
    const patient = await prisma.patient.findUnique({
      where: { id: c.patientId },
      select: { userId: true },
    });
    if (patient) countByUser.set(patient.userId, c._count._all);
  }

  const data: ClientListItem[] = items.map((c) => ({
    id: c.id,
    uniqueClientId: c.uniqueClientId,
    fullName: c.fullName,
    email: c.email,
    mobileNumber: c.mobileNumber,
    status: c.status,
    sessionCount: countByUser.get(c.userId) ?? 0,
    createdAt: c.createdAt,
  }));

  const totalPages = Math.max(1, Math.ceil(totalItems / query.limit));

  return {
    data,
    pagination: {
      currentPage: query.page,
      totalPages,
      totalItems,
      itemsPerPage: query.limit,
    },
  };
}
