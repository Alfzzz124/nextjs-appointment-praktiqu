/**
 * Access control for client data — Feature 004.
 *
 * Enforces BR-10.01: "Professionals see only clients they have had at least
 * one BOOKED or COMPLETED session with."
 *
 * Exported helpers are used by the service layer and/or API routes.
 * The full RBAC matrix is documented in plan.md §Authorization Matrix.
 */

import { AppointmentStatus } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Check whether a professional (Doctor) may access a client record.
 *
 * Rule (BR-10.01): access is granted if the professional has at least one
 * BOOKED or COMPLETED appointment with the client.
 *
 * @param professionalId — the User.id of the professional
 * @param clientId        — the Client.id
 * @returns `true` if access is granted; throws `AccessDeniedError` if not.
 */
export async function canProfessionalAccessClient(
  professionalId: string,
  clientId: string,
): Promise<boolean> {
  const result = await prisma.appointment.findFirst({
    where: {
      doctor: { userId: professionalId },
      patient: { userId: { equals: undefined } }, // find patient by clientId
    },
    // We need to find the patient's userId from the Client record.
    select: { id: true },
  });

  // Resolve the Client's userId.
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { userId: true },
  });
  if (!client) {
    throw new AccessDeniedError('Client not found');
  }

  // Find appointments where the professional (via Doctor.userId) has
  // BOOKED or COMPLETED status with this client.
  const count = await prisma.appointment.count({
    where: {
      doctor: { userId: professionalId },
      patient: { userId: client.userId },
      status: { in: [AppointmentStatus.BOOKED, AppointmentStatus.CHECK_OUT] },
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