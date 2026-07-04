import { prisma } from '@/lib/db';
import type { KcActor } from '@/services/billing/kc-actor';
import { createTax } from '@/services/billing/tax.service';
import type { ImportAdapter } from '../adapters';

/** Resolve the clinic_id an actor may write. SUPER_ADMIN uses the row's; others are forced to their clinic. */
function resolveClinicId(row: any, kc: KcActor): bigint {
  if (kc.actor.role === 'SUPER_ADMIN') return BigInt(row.clinic_id ?? -1);
  return kc.clinicId ?? -1n;
}

export const taxesAdapter: ImportAdapter = {
  async findExisting(row, kc) {
    const clinicId = resolveClinicId(row, kc);
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM wp_kc_taxes WHERE name = ? AND clinic_id = ? LIMIT 1`,
      row.name, clinicId,
    );
    return rows[0] ? Number(rows[0].id) : null;
  },
  async insert(row, kc) {
    const clinicId = resolveClinicId(row, kc);
    await createTax(
      {
        name: row.name,
        rateType: row.tax_type,
        rateValue: row.tax_value,
        clinic: Number(clinicId),
        doctor: [],
        service: [],
        status: row.status,
      },
      Number(kc.wpUserId),
    );
  },
  async update(id, row) {
    await prisma.$executeRawUnsafe(
      `UPDATE wp_kc_taxes SET tax_value = ?, status = ? WHERE id = ?`,
      String(row.tax_value), row.status, id,
    );
  },
};
