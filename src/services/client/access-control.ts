/**
 * Access control for client data — Feature 004.
 *
 * Enforces BR-10.01: "Professionals see only clients they have had at least
 * one BOOKED or COMPLETED session with."
 *
 * Exported helpers are used by the service layer and/or API routes.
 * The full RBAC matrix is documented in plan.md §Authorization Matrix.
 */

import { prisma } from '@/lib/db';
import { ACTIVE_STATUSES, APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';

/**
 * Appointment states that count as "has seen this client".
 *
 * A cancelled appointment must not grant access, but a completed one must — so this is
 * the active set plus CHECK_OUT, not `ACTIVE_STATUSES` alone (CHECK_OUT is a finished
 * visit and does not block a slot, hence its absence there).
 */
const QUALIFYING_STATUSES = [...ACTIVE_STATUSES, APPOINTMENT_STATUS.CHECK_OUT];

/**
 * Check whether a professional may access a client record.
 *
 * Rule (BR-10.01): access is granted if the professional has at least one qualifying
 * appointment with the client.
 *
 * Both ids are WordPress user ids (`wp_users.ID`) — a doctor and a patient are both
 * just WP users. This previously read the `clients` shadow table, which holds no rows;
 * it now reads `wp_kc_appointments` directly.
 *
 * @param professionalWpUserId — the doctor's `wp_users.ID`
 * @param clientWpUserId       — the patient's `wp_users.ID`
 * @returns `true` if access is granted; throws `AccessDeniedError` if not.
 */
export async function canProfessionalAccessClient(
  professionalWpUserId: number | bigint,
  clientWpUserId: number | bigint,
): Promise<boolean> {
  const count = await prisma.kcAppointment.count({
    where: {
      doctorId: BigInt(professionalWpUserId),
      patientId: BigInt(clientWpUserId),
      status: { in: [...QUALIFYING_STATUSES] },
    },
  });

  if (count === 0) {
    throw new AccessDeniedError(
      'Professional access denied: no qualifying session with this client',
    );
  }

  return true;
}

export class AccessDeniedError extends Error {
  constructor(message = 'Access denied') {
    super(message);
    this.name = 'AccessDeniedError';
  }
}

/** Returns true if the actor can list all clients in the practice. */
export function canActorListClients(
  role: 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'PROFESSIONAL' | 'RECEPTIONIST' | 'CLIENT',
): boolean {
  return ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST'].includes(role);
}

/** Returns true if the actor can create clients in the practice. */
export function canActorCreateClient(
  role: 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'PROFESSIONAL' | 'RECEPTIONIST' | 'CLIENT',
): boolean {
  return ['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST'].includes(role);
}

/** Returns true if the actor can edit a client's status. */
export function canActorChangeStatus(
  role: 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'PROFESSIONAL' | 'RECEPTIONIST' | 'CLIENT',
): boolean {
  return ['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(role);
}