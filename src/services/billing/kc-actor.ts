import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { Actor } from '@/lib/auth';

export interface KcActor {
  actor: Actor;
  wpUserId: bigint;          // = wp_users.ID; used as doctor_id / patient_id
  clinicId: bigint | null;   // resolved clinic for CLINIC_ADMIN / RECEPTIONIST / PROFESSIONAL
}

/** One clinic a CLINIC_ADMIN may switch to, as /auth/me reports it. */
export interface AdminClinic {
  id: number;
  name: string;
  active: boolean;
}

/** Resolve the JWT actor to KiviCare ids. */
export async function resolveKcActor(actor: Actor): Promise<KcActor> {
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { wpUserId: true },
  });
  if (!user?.wpUserId) {
    throw new KcError('User is not linked to a WordPress account', 403);
  }
  const wpUserId = user.wpUserId;

  const clinicId = await resolveClinicId(actor.role, wpUserId);
  return { actor, wpUserId, clinicId };
}

/**
 * The clinic an actor works in when the request names none, by role.
 *
 * CLINIC_ADMIN: the first of `listAdminClinicIds`. RECEPTIONIST: their first receptionist
 * mapping. PROFESSIONAL: their first doctor mapping. Anyone else has none. "First" is by
 * id, so the answer never depends on the order the database happens to return rows in.
 */
export async function resolveClinicId(role: Actor['role'], wpUserId: bigint): Promise<bigint | null> {
  if (role === 'CLINIC_ADMIN') {
    const [first] = await listAdminClinicIds(wpUserId);
    return first ?? null;
  }
  if (role === 'PROFESSIONAL') {
    const mapping = await prisma.kcDoctorClinicMapping.findFirst({
      where: { doctorId: wpUserId },
      select: { clinicId: true },
      orderBy: { id: 'asc' },
    });
    return mapping?.clinicId ?? null;
  }
  if (role === 'RECEPTIONIST') {
    const mapping = await prisma.kcReceptionistClinicMapping.findFirst({
      where: { receptionistId: wpUserId },
      select: { clinicId: true },
      orderBy: { id: 'asc' },
    });
    return mapping?.clinicId ?? null;
  }
  return null;
}

/**
 * Every clinic a CLINIC_ADMIN may act in, default first.
 *
 * The source is wp_kc_clinics.clinic_admin_id, KiviCare's own definition of "admin of
 * clinic X": active clinics first, then inactive ones, each group by id. Only an admin who
 * owns no clinic at all falls back to their doctor mappings (by mapping id). Being mapped
 * as a doctor at a clinic deliberately does NOT make someone its admin otherwise.
 */
export async function listAdminClinicIds(wpUserId: bigint): Promise<bigint[]> {
  return (await adminClinicRows(wpUserId)).map((c) => c.id);
}

/** `listAdminClinicIds` with names and the active flag, in exactly the same order. */
export async function listAdminClinics(wpUserId: bigint): Promise<AdminClinic[]> {
  return (await adminClinicRows(wpUserId)).map((c) => ({
    id: Number(c.id),
    name: c.name?.trim() || `Klinik #${c.id}`,
    active: c.status === 1,
  }));
}

type ClinicRow = { id: bigint; name: string | null; status: number };

async function adminClinicRows(wpUserId: bigint): Promise<ClinicRow[]> {
  const owned = await prisma.kcClinic.findMany({
    where: { clinicAdminId: wpUserId },
    select: { id: true, name: true, status: true },
    orderBy: { id: 'asc' },
  });
  if (owned.length > 0) {
    return [...owned.filter((c) => c.status === 1), ...owned.filter((c) => c.status !== 1)];
  }

  const mappings = await prisma.kcDoctorClinicMapping.findMany({
    where: { doctorId: wpUserId },
    select: { clinicId: true },
    orderBy: { id: 'asc' },
  });
  const ids: bigint[] = [];
  for (const m of mappings) {
    if (!ids.includes(m.clinicId)) ids.push(m.clinicId);
  }
  if (ids.length === 0) return [];

  const clinics = await prisma.kcClinic.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, status: true },
  });
  const byId = new Map(clinics.map((c) => [c.id.toString(), c]));
  // Mapping order is kept. A mapping to a clinic row that no longer exists keeps its id,
  // exactly as the old first-mapping resolver did.
  return ids.map((id) => byId.get(id.toString()) ?? { id, name: null, status: 0 });
}
