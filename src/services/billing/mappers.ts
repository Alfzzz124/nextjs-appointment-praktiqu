import { toNum, bigToNum } from '@/lib/kc-num';
import type { KcTax } from '@prisma/client';

export type MetaRow = { metaKey: string | null; metaValue: string | null };

export function metaToMap(rows: MetaRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) if (r.metaKey) out[r.metaKey] = r.metaValue ?? '';
  return out;
}

export function fullNameFromMeta(map: Record<string, string>): string {
  return `${map.first_name ?? ''} ${map.last_name ?? ''}`.trim();
}

/** Build a WP attachment URL; null id → null. KiviCare stores attachment ids in meta. */
export function attachmentUrl(id: number | null): string | null {
  if (!id) return null;
  const base = process.env.WP_UPLOADS_BASE_URL ?? '';
  return base ? `${base}/?attachment_id=${id}` : null;
}

export interface TaxApi {
  id: number; name: string; taxType: string; taxValue: number;
  clinicId: number | null; doctorId: number | null; serviceId: number | null;
  actual_service_id: number | null; addedBy: number | null; status: number;
  createdAt: Date; serviceName?: string | null;
}

export function taxRowToApi(
  row: KcTax,
  extra: { actual_service_id: number | null; serviceName: string | null },
): TaxApi {
  return {
    id: Number(row.id),
    name: row.name ?? '',
    taxType: row.taxType ?? 'percentage',
    taxValue: toNum(row.taxValue),
    clinicId: bigToNum(row.clinicId),
    doctorId: bigToNum(row.doctorId),
    serviceId: bigToNum(row.serviceId),
    actual_service_id: extra.actual_service_id,
    addedBy: bigToNum(row.addedBy),
    status: row.status,
    createdAt: row.createdAt,
    serviceName: extra.serviceName,
  };
}
