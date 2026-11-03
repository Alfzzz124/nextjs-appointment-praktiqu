/**
 * Clinic owners ("pemilik klinik"): psychologists allowed to run a clinic's operations —
 * services, schedules, appointments, clients, billing, reports — without becoming its
 * clinic admin. See docs/superpowers/specs/2026-10-16-psikolog-pemilik-klinik-design.md.
 *
 * Ownership is never trusted from the clinic_owners table alone. A psychologist owns
 * clinic C only while they are an ACTIVE doctor mapped to C AND (they are ticked in
 * clinic_owners OR they are C's only active doctor). That way a row left behind by an
 * unmapping or a deactivation grants nothing, and a second psychologist joining a solo
 * clinic ends the automatic ownership on the very next request.
 */
import { prisma } from '@/lib/db';
import { audit } from '@/lib/logging';
import { CAPABILITIES_KEY, KIVICARE_ROLES, roleLikePattern } from '@/repositories/wp/wp-user';
import { PROFESSIONAL_STATUS, PROFESSIONAL_STATUS_META_KEY } from '@/repositories/wp/doctors.repo';

export type OwnerSource = 'manual' | 'solo';

export interface OwnedClinic {
  id: number;
  name: string;
  source: OwnerSource;
}

export interface RosterEntry {
  doctorId: number;
  name: string;
  owner: boolean;
  source: OwnerSource | null;
}

export class NotAClinicProfessionalError extends Error {
  constructor(public doctorIds: number[]) {
    super('not_a_clinic_professional');
    this.name = 'NotAClinicProfessionalError';
  }
}

const byId = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Active psychologists mapped to each clinic, as clinicId → doctor ids (ascending).
 *
 * "Active" follows doctors.repo.ts: the praktiqu status meta is ACTIVE, empty or absent.
 * wp_users.user_status is deliberately ignored — KiviCare's own use of it contradicts
 * itself (doctors.repo.ts:30-36).
 */
async function activeDoctorsByClinic(clinicIds: bigint[]): Promise<Map<bigint, bigint[]>> {
  const out = new Map<bigint, bigint[]>();
  if (clinicIds.length === 0) return out;
  const rows = await prisma.$queryRawUnsafe<{ clinicId: bigint; doctorId: bigint }[]>(
    `SELECT DISTINCT dcm.clinic_id AS clinicId, dcm.doctor_id AS doctorId
       FROM wp_kc_doctor_clinic_mappings dcm
       JOIN wp_users u ON u.ID = dcm.doctor_id
      WHERE dcm.clinic_id IN (${clinicIds.map(() => '?').join(',')})
        AND EXISTS (
          SELECT 1 FROM wp_usermeta cap
           WHERE cap.user_id = u.ID AND cap.meta_key = ? AND cap.meta_value LIKE ?)
        AND NOT EXISTS (
          SELECT 1 FROM wp_usermeta st
           WHERE st.user_id = u.ID AND st.meta_key = ? AND st.meta_value <> '' AND st.meta_value <> ?)
      ORDER BY dcm.doctor_id`,
    ...clinicIds,
    CAPABILITIES_KEY,
    roleLikePattern(KIVICARE_ROLES.doctor),
    PROFESSIONAL_STATUS_META_KEY,
    PROFESSIONAL_STATUS.ACTIVE,
  );
  for (const r of rows) {
    const clinicId = BigInt(r.clinicId);
    out.set(clinicId, [...(out.get(clinicId) ?? []), BigInt(r.doctorId)]);
  }
  return out;
}

/** Every clinic this psychologist owns right now, ascending by id. */
export async function listOwnedClinics(wpUserId: bigint): Promise<OwnedClinic[]> {
  const mapped = await prisma.kcDoctorClinicMapping.findMany({
    where: { doctorId: wpUserId },
    select: { clinicId: true },
  });
  const clinicIds = [...new Set(mapped.map((m) => m.clinicId))].sort(byId);
  if (clinicIds.length === 0) return [];

  const [active, manual, clinics] = await Promise.all([
    activeDoctorsByClinic(clinicIds),
    prisma.clinicOwner.findMany({
      where: { doctorWpUserId: wpUserId, clinicId: { in: clinicIds } },
      select: { clinicId: true },
    }),
    prisma.kcClinic.findMany({ where: { id: { in: clinicIds } }, select: { id: true, name: true } }),
  ]);
  const ticked = new Set(manual.map((m) => m.clinicId));
  const names = new Map(clinics.map((c) => [c.id, c.name?.trim() || `Klinik #${c.id}`]));

  const out: OwnedClinic[] = [];
  for (const id of clinicIds) {
    const doctors = active.get(id) ?? [];
    if (!doctors.includes(wpUserId)) continue; // not an active doctor here
    const source: OwnerSource | null = ticked.has(id) ? 'manual' : doctors.length === 1 ? 'solo' : null;
    if (source !== null) out.push({ id: Number(id), name: names.get(id) ?? `Klinik #${id}`, source });
  }
  return out;
}

export async function isClinicOwner(wpUserId: bigint, clinicId: bigint): Promise<boolean> {
  return (await listOwnedClinics(wpUserId)).some((c) => BigInt(c.id) === clinicId);
}

/** The clinic's active psychologists, each with whether they own it and why. */
export async function listClinicOwnerRoster(clinicId: bigint): Promise<RosterEntry[]> {
  const doctors = (await activeDoctorsByClinic([clinicId])).get(clinicId) ?? [];
  if (doctors.length === 0) return [];

  const [manual, users] = await Promise.all([
    prisma.clinicOwner.findMany({
      where: { clinicId, doctorWpUserId: { in: doctors } },
      select: { doctorWpUserId: true },
    }),
    prisma.kcUser.findMany({ where: { id: { in: doctors } }, select: { id: true, displayName: true } }),
  ]);
  const ticked = new Set(manual.map((m) => m.doctorWpUserId));
  const names = new Map(users.map((u) => [u.id, u.displayName?.trim() || `Psikolog #${u.id}`]));
  const solo = doctors.length === 1;

  return doctors.map((d) => {
    const source: OwnerSource | null = ticked.has(d) ? 'manual' : solo ? 'solo' : null;
    return { doctorId: Number(d), name: names.get(d) ?? `Psikolog #${d}`, owner: source !== null, source };
  });
}

/**
 * Replace the clinic's MANUAL owners with exactly `doctorIds`.
 *
 * Every id must be an active psychologist of the clinic; otherwise nothing is written.
 * Solo ownership is not stored, so sending or omitting a solo psychologist changes
 * nothing about their access while the clinic stays solo.
 */
export async function setClinicOwners(
  clinicId: bigint,
  doctorIds: number[],
  actorId: string,
): Promise<RosterEntry[]> {
  const wanted = [...new Set(doctorIds)].map((id) => BigInt(id));
  const active = (await activeDoctorsByClinic([clinicId])).get(clinicId) ?? [];
  const strangers = wanted.filter((id) => !active.includes(id));
  if (strangers.length > 0) throw new NotAClinicProfessionalError(strangers.map(Number));

  const current = await prisma.clinicOwner.findMany({ where: { clinicId }, select: { doctorWpUserId: true } });
  const have = new Set(current.map((c) => c.doctorWpUserId));
  const want = new Set(wanted);
  const grant = wanted.filter((id) => !have.has(id));
  const revoke = [...have].filter((id) => !want.has(id));

  await prisma.$transaction([
    prisma.clinicOwner.deleteMany({ where: { clinicId, doctorWpUserId: { in: revoke } } }),
    prisma.clinicOwner.createMany({
      data: grant.map((doctorWpUserId) => ({ clinicId, doctorWpUserId, createdBy: actorId })),
      skipDuplicates: true,
    }),
  ]);

  for (const d of grant) {
    await audit('clinic_owner.granted', {
      userId: actorId, resource: 'clinic', resourceId: String(clinicId), metadata: { doctorId: String(d) },
    });
  }
  for (const d of revoke) {
    await audit('clinic_owner.revoked', {
      userId: actorId, resource: 'clinic', resourceId: String(clinicId), metadata: { doctorId: String(d) },
    });
  }

  return listClinicOwnerRoster(clinicId);
}
