import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';
import type { ImportAdapter } from '../adapters';
import { provisionWpUser } from '../wp-provision';

// 'kiviCare_doctor'.length === 15
const DOCTOR_CAPABILITY = 'a:1:{s:15:"kiviCare_doctor";b:1;}';

function resolveClinicId(row: any, kc: KcActor): bigint {
  const clinicId = kc.actor.role === 'SUPER_ADMIN' ? BigInt(row.clinic_id ?? 0) : (kc.clinicId ?? BigInt(row.clinic_id ?? 0));
  if (!clinicId || clinicId <= 0n) throw new KcError('clinicId is required', 400);
  return clinicId;
}

export const doctorsAdapter: ImportAdapter = {
  async findExisting(row) {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT ID FROM wp_users WHERE user_email = ? LIMIT 1`,
      row.email,
    );
    return rows[0] ? Number(rows[0].ID) : null;
  },
  async insert(row, kc) {
    await provisionWpUser({
      name: row.name,
      email: row.email,
      clinicId: resolveClinicId(row, kc),
      capabilitySerialized: DOCTOR_CAPABILITY,
      mappingTable: 'wp_kc_doctor_clinic_mappings',
      mappingIdCol: 'doctor_id',
      mappingHasOwner: true,
    });
  },
};
