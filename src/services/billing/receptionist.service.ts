import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';
import type { ReceptionistScope } from '@/services/billing/staff-scope';

const RECEPTIONIST_CAP = '%kiviCare_receptionist%';

export interface ReceptionistListParams { page: number; perPage: number | 'all'; clinicId?: number; search?: string; }

function mapRow(r: any) {
  return {
    id: Number(r.ID),
    user_login: r.user_login,
    display_name: r.display_name,
    email: r.user_email,
    status: Number(r.user_status),
  };
}

/** Base: wp_users that carry the receptionist capability. Scope adds a clinic-mapping EXISTS. */
function buildWhere(scope: ReceptionistScope | null, p: Partial<ReceptionistListParams>) {
  const where: string[] = [
    `EXISTS (SELECT 1 FROM wp_usermeta cap WHERE cap.user_id = u.ID AND cap.meta_key = 'wp_capabilities' AND cap.meta_value LIKE ?)`,
  ];
  const args: unknown[] = [RECEPTIONIST_CAP];
  if (scope?.clinicId !== undefined) {
    where.push(`EXISTS (SELECT 1 FROM wp_kc_receptionist_clinic_mappings rcm WHERE rcm.receptionist_id = u.ID AND rcm.clinic_id = ?)`);
    args.push(scope.clinicId);
  }
  if (p.clinicId !== undefined) {
    where.push(`EXISTS (SELECT 1 FROM wp_kc_receptionist_clinic_mappings rcm2 WHERE rcm2.receptionist_id = u.ID AND rcm2.clinic_id = ?)`);
    args.push(p.clinicId);
  }
  if (p.search) { where.push(`(u.display_name LIKE ? OR u.user_email LIKE ?)`); args.push(`%${p.search}%`, `%${p.search}%`); }
  return { whereSql: where.join(' AND '), args };
}

export async function listReceptionists(p: ReceptionistListParams, scope: ReceptionistScope | null) {
  const { whereSql, args } = buildWhere(scope, p);
  const countRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS n FROM wp_users u WHERE ${whereSql}`, ...args);
  const total = Number(countRows[0]?.n ?? 0);
  let limitSql = ''; const pageArgs: unknown[] = [];
  if (p.perPage !== 'all') { limitSql = ' LIMIT ? OFFSET ?'; pageArgs.push(p.perPage as number, (p.page - 1) * (p.perPage as number)); }
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT u.ID, u.user_login, u.display_name, u.user_email, u.user_status FROM wp_users u WHERE ${whereSql} ORDER BY u.ID DESC${limitSql}`,
    ...args, ...pageArgs,
  );
  return { receptionists: rows.map(mapRow), pagination: { page: p.page, perPage: p.perPage, total } };
}

export async function getReceptionist(id: number, scope: ReceptionistScope | null) {
  const { whereSql, args } = buildWhere(scope, {});
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT u.ID, u.user_login, u.display_name, u.user_email, u.user_status FROM wp_users u WHERE ${whereSql} AND u.ID = ?`, ...args, id,
  );
  if (!rows[0]) throw new KcError('Receptionist not found', 404);
  return mapRow(rows[0]);
}

export interface ReceptionistCreateInput { name: string; email: string; clinicId?: number; }

/** Full WP provisioning inside ONE interactive transaction (LAST_INSERT_ID is connection-safe). */
export async function createReceptionist(input: ReceptionistCreateInput, kc: KcActor): Promise<{ id: number }> {
  const clinicId = kc.actor.role === 'SUPER_ADMIN' ? BigInt(input.clinicId ?? 0) : (kc.clinicId ?? BigInt(input.clinicId ?? 0));
  if (!clinicId || clinicId <= 0n) throw new KcError('clinicId is required', 400);

  // Email uniqueness
  const existing = await prisma.$queryRawUnsafe<any[]>(`SELECT ID FROM wp_users WHERE user_email = ? LIMIT 1`, input.email);
  if (existing[0]) throw new KcError('A user with this email already exists', 409);

  const username = input.email.split('@')[0].slice(0, 60);
  const first = input.name.split(' ')[0];
  const last = input.name.split(' ').slice(1).join(' ') || '-';
  // Non-loginable placeholder hash; real auth is via the WP plugin. (No secret material.)
  const placeholderHash = '!disabled-' + username.slice(0, 20);

  const newId = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO wp_users (user_login, user_pass, user_nicename, display_name, user_email, user_url, user_registered, user_activation_key, user_status)
       VALUES (?, ?, ?, ?, ?, '', NOW(), '', 0)`,
      username, placeholderHash, username, input.name, input.email,
    );
    const idRow = await tx.$queryRawUnsafe<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    const wpId = Number(idRow[0].id);
    await tx.$executeRawUnsafe(
      `INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES
       (?, 'first_name', ?), (?, 'last_name', ?),
       (?, 'wp_capabilities', 'a:1:{s:21:"kiviCare_receptionist";b:1;}'),
       (?, 'wp_user_level', '0')`,
      wpId, first, wpId, last, wpId, wpId,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO wp_kc_receptionist_clinic_mappings (receptionist_id, clinic_id, created_at) VALUES (?, ?, NOW())`,
      wpId, clinicId,
    );
    return wpId;
  });
  return { id: newId };
}

export interface ReceptionistUpdateInput { name?: string; }
export async function updateReceptionist(id: number, input: ReceptionistUpdateInput, scope: ReceptionistScope | null): Promise<void> {
  await getReceptionist(id, scope); // scope + existence
  if (input.name !== undefined) {
    const first = input.name.split(' ')[0];
    const last = input.name.split(' ').slice(1).join(' ') || '-';
    await prisma.$executeRawUnsafe(`UPDATE wp_users SET display_name = ? WHERE ID = ?`, input.name, id);
    await prisma.$executeRawUnsafe(`UPDATE wp_usermeta SET meta_value = ? WHERE user_id = ? AND meta_key = 'first_name'`, first, id);
    await prisma.$executeRawUnsafe(`UPDATE wp_usermeta SET meta_value = ? WHERE user_id = ? AND meta_key = 'last_name'`, last, id);
  }
}

/** Soft delete = deactivate (user_status = 1). */
export async function deleteReceptionist(id: number, scope: ReceptionistScope | null): Promise<void> {
  await getReceptionist(id, scope);
  await prisma.$executeRawUnsafe(`UPDATE wp_users SET user_status = 1 WHERE ID = ?`, id);
}

async function scopedIds(ids: number[], scope: ReceptionistScope | null): Promise<number[]> {
  if (ids.length === 0) return [];
  const { whereSql, args } = buildWhere(scope, {});
  const placeholders = ids.map(() => '?').join(',');
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT u.ID FROM wp_users u WHERE ${whereSql} AND u.ID IN (${placeholders})`, ...args, ...ids);
  return rows.map((r) => Number(r.ID));
}

export async function bulkDeleteReceptionists(ids: number[], scope: ReceptionistScope | null): Promise<number> {
  const ok = await scopedIds(ids, scope);
  if (ok.length === 0) return 0;
  const ph = ok.map(() => '?').join(',');
  await prisma.$executeRawUnsafe(`UPDATE wp_users SET user_status = 1 WHERE ID IN (${ph})`, ...ok);
  return ok.length;
}

export async function bulkSetReceptionistStatus(ids: number[], status: number, scope: ReceptionistScope | null): Promise<number> {
  if (status !== 0 && status !== 1) throw new KcError('Invalid status', 400);
  const ok = await scopedIds(ids, scope);
  if (ok.length === 0) return 0;
  const ph = ok.map(() => '?').join(',');
  await prisma.$executeRawUnsafe(`UPDATE wp_users SET user_status = ? WHERE ID IN (${ph})`, status, ...ok);
  return ok.length;
}

export async function exportReceptionists(p: ReceptionistListParams, scope: ReceptionistScope | null) {
  const list = await listReceptionists({ ...p, perPage: 'all', page: 1 }, scope);
  return { receptionists: list.receptionists };
}
