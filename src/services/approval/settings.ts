/**
 * `professional_approval_settings` — a psychologist's own switch: "paid online bookings
 * wait for my approval". No row means off, so every psychologist behaves exactly as
 * before until someone turns it on. Read when a payment lands, never cached.
 *
 * Spec: docs/superpowers/specs/2026-10-19-approval-psikolog-design.md §4.1
 */
import { prisma } from '@/lib/db';

export type ApprovalSetting = {
  professionalId: number;
  requiresApproval: boolean;
  updatedAt: Date | null;
  /** users.id (cuid) */
  updatedBy: string | null;
};

export async function requiresApproval(professionalId: number): Promise<boolean> {
  const row = await prisma.professionalApprovalSetting.findUnique({
    where: { doctorWpUserId: BigInt(professionalId) },
    select: { requiresApproval: true },
  });
  return row?.requiresApproval === true;
}

/** Of these psychologists, the ones whose switch is on. One query for a whole directory. */
export async function professionalsRequiringApproval(professionalIds: number[]): Promise<Set<number>> {
  if (professionalIds.length === 0) return new Set();
  const rows = await prisma.professionalApprovalSetting.findMany({
    where: { doctorWpUserId: { in: professionalIds.map((id) => BigInt(id)) }, requiresApproval: true },
    select: { doctorWpUserId: true },
  });
  return new Set(rows.map((r) => Number(r.doctorWpUserId)));
}

export async function getApprovalSetting(professionalId: number): Promise<ApprovalSetting> {
  const row = await prisma.professionalApprovalSetting.findUnique({
    where: { doctorWpUserId: BigInt(professionalId) },
  });
  return {
    professionalId,
    requiresApproval: row?.requiresApproval === true,
    updatedAt: row?.updatedAt ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

export async function setApprovalSetting(
  professionalId: number,
  value: boolean,
  by: string,
): Promise<{ before: boolean; after: ApprovalSetting }> {
  const before = await requiresApproval(professionalId);
  const id = BigInt(professionalId);
  const row = await prisma.professionalApprovalSetting.upsert({
    where: { doctorWpUserId: id },
    create: { doctorWpUserId: id, requiresApproval: value, updatedBy: by },
    update: { requiresApproval: value, updatedBy: by },
  });
  return {
    before,
    after: {
      professionalId,
      requiresApproval: row.requiresApproval,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    },
  };
}
