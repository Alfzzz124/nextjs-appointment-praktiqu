import { prisma } from '@/lib/db';
import type { ImportAdapter } from '../adapters';
import { requireClinicId } from '../clinic-scope';
import { provisionWpUser } from '../wp-provision';

// 'kiviCare_patient'.length === 16
const PATIENT_CAPABILITY = 'a:1:{s:16:"kiviCare_patient";b:1;}';

export const patientsAdapter: ImportAdapter = {
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
      clinicId: requireClinicId(row, kc),
      capabilitySerialized: PATIENT_CAPABILITY,
      mappingTable: 'wp_kc_patient_clinic_mappings',
      mappingIdCol: 'patient_id',
      mappingHasOwner: false,
    });
  },
};
