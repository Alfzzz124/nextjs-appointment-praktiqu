/**
 * Lookup values, straight from KiviCare's `wp_kc_static_data`.
 *
 * One table holds every enumeration KiviCare offers, discriminated by `type`:
 * specializations, blood groups, qualifications, service categories. Our schema
 * duplicates the specializations as `specialties` + `_DoctorToSpecialty`, which should
 * not exist — see docs/architecture/shadow-tables-audit.md.
 *
 * Reads only. Writes go through the praktiqu-endpoint plugin's REST layer (D1).
 */
import { prisma } from '@/lib/db';

/** The `type` vocabulary KiviCare writes. */
export const STATIC_DATA_TYPE = {
  SPECIALIZATION: 'specialization',
  BLOOD_GROUP: 'blood_group',
  QUALIFICATION: 'qualification',
  SERVICE_LIST: 'service_list',
  /** Service categories. `value` is what lands in `wp_kc_services.type`. */
  SERVICE_TYPE: 'service_type',
} as const;

export type StaticDataType = (typeof STATIC_DATA_TYPE)[keyof typeof STATIC_DATA_TYPE];

/** `status` is a BIGINT here, not the usual TINYINT — 1 = active. */
const STATUS_ACTIVE = 1n;

export type WpStaticData = {
  id: bigint;
  type: string;
  label: string | null;
  value: string | null;
  parentId: bigint | null;
  isActive: boolean;
  createdAt: Date;
};

const SELECT = {
  id: true,
  type: true,
  label: true,
  value: true,
  parentId: true,
  status: true,
  createdAt: true,
} as const;

type StaticDataRow = {
  id: bigint;
  type: string;
  label: string | null;
  value: string | null;
  parentId: bigint | null;
  status: bigint;
  createdAt: Date;
};

function toStaticData(row: StaticDataRow): WpStaticData {
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    value: row.value,
    parentId: row.parentId,
    isActive: row.status === STATUS_ACTIVE,
    createdAt: row.createdAt,
  };
}

/**
 * An unknown `type` returns an empty list rather than throwing: unlike a day-of-week
 * slug, the type vocabulary is open — KiviCare add-ons introduce their own — so a
 * caller asking for a type this install doesn't use is a legitimate empty result.
 */
export async function listStaticData(query: {
  type: string;
  includeInactive?: boolean;
}): Promise<WpStaticData[]> {
  const where: Record<string, unknown> = { type: query.type };
  if (!query.includeInactive) where.status = STATUS_ACTIVE;

  const rows = await prisma.kcStaticData.findMany({
    where,
    select: SELECT,
    orderBy: [{ label: 'asc' }, { id: 'asc' }],
  });

  return (rows as StaticDataRow[]).map(toStaticData);
}

export function listSpecializations(opts: { includeInactive?: boolean } = {}) {
  return listStaticData({ type: STATIC_DATA_TYPE.SPECIALIZATION, ...opts });
}

export function listBloodGroups(opts: { includeInactive?: boolean } = {}) {
  return listStaticData({ type: STATIC_DATA_TYPE.BLOOD_GROUP, ...opts });
}

export function listQualifications(opts: { includeInactive?: boolean } = {}) {
  return listStaticData({ type: STATIC_DATA_TYPE.QUALIFICATION, ...opts });
}

export function listServiceTypes(opts: { includeInactive?: boolean } = {}) {
  return listStaticData({ type: STATIC_DATA_TYPE.SERVICE_TYPE, ...opts });
}

/**
 * One active `service_type` row by id.
 *
 * The `type` guard is not decoration: `category` arrives from a client as a bare
 * integer, and every other enumeration KiviCare owns lives in this same table. Without
 * it, a blood-group id would happily become a service category.
 */
export async function findServiceTypeById(id: bigint): Promise<WpStaticData | null> {
  const row = await prisma.kcStaticData.findFirst({
    where: { id, type: STATIC_DATA_TYPE.SERVICE_TYPE, status: STATUS_ACTIVE },
    select: SELECT,
  });
  return row ? toStaticData(row as StaticDataRow) : null;
}
