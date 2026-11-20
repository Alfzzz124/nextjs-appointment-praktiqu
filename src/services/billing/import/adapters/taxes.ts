import { prisma } from '@/lib/db';
import { createTax } from '@/services/billing/tax.service';
import { taxScopeFor } from '@/services/billing/kc-permissions';
import type { KcActor } from '@/services/billing/kc-actor';
import type { ImportAdapter } from '../adapters';
import { resolveClinicId, requireClinicId } from '../clinic-scope';

/**
 * The clinic a tax row is read from and written to.
 *
 * A global tax (clinic -1) applies to every clinic's bills, so, as on the /taxes routes,
 * only SUPER_ADMIN may import one. Anyone else needs a clinic of their own: for them
 * resolveClinicId falls back to -1, so a row named like a global tax would be matched
 * and overwritten for every clinic, and a new row would become a global tax.
 */
function taxClinicId(row: any, kc: KcActor): bigint {
  return kc.actor.role === 'SUPER_ADMIN' ? resolveClinicId(row, kc) : requireClinicId(row, kc);
}

export const taxesAdapter: ImportAdapter = {
  async findExisting(row, kc) {
    const clinicId = taxClinicId(row, kc);
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM wp_kc_taxes WHERE name = ? AND clinic_id = ? LIMIT 1`,
      row.name, clinicId,
    );
    return rows[0] ? Number(rows[0].id) : null;
  },
  async insert(row, kc) {
    const clinicId = taxClinicId(row, kc);
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
      // The same check the /taxes routes make, as a second layer.
      taxScopeFor(kc),
    );
  },
  async update(id, row) {
    // `id` came from findExisting, which already resolved the caller's clinic.
    await prisma.$executeRawUnsafe(
      `UPDATE wp_kc_taxes SET tax_value = ?, status = ? WHERE id = ?`,
      String(row.tax_value), row.status, id,
    );
  },
};
