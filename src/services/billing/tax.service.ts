import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import { taxRowToApi, type TaxApi } from './mappers';

const SORT_COLUMNS: Record<string, string> = {
  taxName: 't.name', taxRate: 't.tax_value', status: 't.status', id: 't.id',
};

export interface TaxListResult {
  taxes: TaxApi[]; page: number; per_page: number; total: number; total_pages: number;
}

export interface TaxListParams {
  id?: number; taxName?: string; status?: number; clinic?: number;
  doctor?: number[]; service?: number[];
  orderby?: string; order?: string; page: number; perPage: number | 'all';
}

/** scope=null means unrestricted (super admin). */
export async function listTaxes(p: TaxListParams, scope: { clinicId: bigint } | null): Promise<TaxListResult> {
  const where: string[] = ['1=1'];
  const args: any[] = [];
  if (p.id) { where.push('t.id = ?'); args.push(p.id); }
  if (p.taxName) { where.push('t.name LIKE ?'); args.push(`%${p.taxName}%`); }
  if (p.status !== undefined) { where.push('t.status = ?'); args.push(p.status); }
  if (p.clinic !== undefined) { where.push('t.clinic_id = ?'); args.push(p.clinic); }
  if (scope) { where.push('(t.clinic_id = ? OR t.clinic_id = -1 OR t.clinic_id IS NULL)'); args.push(scope.clinicId); }

  const orderCol = SORT_COLUMNS[p.orderby ?? 'id'] ?? 't.id';
  const orderDir = (p.order ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const whereSql = where.join(' AND ');

  const countRows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
    `SELECT COUNT(DISTINCT t.id) c FROM wp_kc_taxes t WHERE ${whereSql}`, ...args,
  );
  const total = Number(countRows[0]?.c ?? 0);

  let limitSql = '';
  const page = p.page ?? 1;
  const perPage = p.perPage === 'all' ? total || 1 : p.perPage;
  if (p.perPage !== 'all') limitSql = `LIMIT ${perPage} OFFSET ${(page - 1) * (perPage as number)}`;

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT t.*, s.name AS service_name, sdm.service_id AS actual_service_id
     FROM wp_kc_taxes t
     LEFT JOIN wp_kc_service_doctor_mapping sdm ON t.service_id = sdm.id
     LEFT JOIN wp_kc_services s ON sdm.service_id = s.id
     WHERE ${whereSql}
     GROUP BY t.id
     ORDER BY ${orderCol} ${orderDir}
     ${limitSql}`,
    ...args,
  );

  const taxes = rows.map((r) =>
    taxRowToApi(
      { id: r.id, name: r.name, taxType: r.tax_type, taxValue: r.tax_value, clinicId: r.clinic_id,
        doctorId: r.doctor_id, serviceId: r.service_id, addedBy: r.added_by, status: r.status, createdAt: r.created_at } as any,
      { actual_service_id: r.actual_service_id ? Number(r.actual_service_id) : null, serviceName: r.service_name ?? null },
    ),
  );

  return { taxes, page, per_page: perPage as number, total, total_pages: perPage ? Math.ceil(total / (perPage as number)) : 1 };
}

export async function getTax(id: number): Promise<TaxApi> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT t.*, s.name AS service_name, sdm.service_id AS actual_service_id
     FROM wp_kc_taxes t
     LEFT JOIN wp_kc_service_doctor_mapping sdm ON t.service_id = sdm.id
     LEFT JOIN wp_kc_services s ON sdm.service_id = s.id
     WHERE t.id = ? LIMIT 1`, id,
  );
  if (rows.length === 0) throw new KcError('Tax not found', 404);
  const r = rows[0];
  return taxRowToApi(
    { id: r.id, name: r.name, taxType: r.tax_type, taxValue: r.tax_value, clinicId: r.clinic_id,
      doctorId: r.doctor_id, serviceId: r.service_id, addedBy: r.added_by, status: r.status, createdAt: r.created_at } as any,
    { actual_service_id: r.actual_service_id ? Number(r.actual_service_id) : null, serviceName: r.service_name ?? null },
  );
}

export interface TaxCreateInput {
  name: string; rateType: 'percentage' | 'fixed'; rateValue: number;
  clinic: number; doctor: number[]; service: number[]; status?: number; addedBy?: number;
}

export interface TaxCreateResult { ids: number[]; created_count: number; skipped_count: number; }

export async function createTax(input: TaxCreateInput, currentUserId: number): Promise<TaxCreateResult> {
  if (!(input.rateValue > 0)) throw new KcError('Tax rate must be greater than 0', 400);

  const clinicId = input.clinic ?? -1;
  const doctors = input.doctor.length ? input.doctor : [-1];
  const services = input.service.length ? input.service : [-1];

  // If both specific doctor and service: resolve to service-doctor-mapping ids (status=1).
  const combos: { doctorId: number; serviceId: number }[] = [];
  for (const d of doctors) {
    for (const s of services) {
      if (d !== -1 && s !== -1) {
        const map = await prisma.kcServiceDoctorMapping.findFirst({
          where: { doctorId: BigInt(d), serviceId: BigInt(s), status: 1 }, select: { id: true },
        });
        if (map) combos.push({ doctorId: d, serviceId: Number(map.id) });
        else combos.push({ doctorId: d, serviceId: s }); // fall back to raw service id
      } else {
        combos.push({ doctorId: d, serviceId: s });
      }
    }
  }

  const ids: number[] = [];
  let skipped = 0;
  for (const c of combos) {
    const dup = await prisma.kcTax.findFirst({
      where: {
        name: input.name, taxType: input.rateType,
        clinicId: BigInt(clinicId), doctorId: BigInt(c.doctorId), serviceId: BigInt(c.serviceId),
      },
      select: { id: true },
    });
    if (dup) { skipped++; continue; }
    const created = await prisma.kcTax.create({
      data: {
        name: input.name, taxType: input.rateType, taxValue: String(input.rateValue),
        clinicId: BigInt(clinicId), doctorId: BigInt(c.doctorId), serviceId: BigInt(c.serviceId),
        addedBy: BigInt(input.addedBy ?? currentUserId), status: input.status ?? 1, createdAt: new Date(),
      },
      select: { id: true },
    });
    ids.push(Number(created.id));
  }
  return { ids, created_count: ids.length, skipped_count: skipped };
}
