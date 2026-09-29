/**
 * Whether a WordPress account may still hold a session, read straight from the DB.
 *
 * Deactivating a receptionist (or anyone else) writes `wp_users.user_status` or the
 * `praktiqu_user_status` meta — WordPress-side state. The app's own `users.status` only
 * follows it at LOGIN, when the plugin's identity is copied over. A session that was
 * already open kept refreshing against the stale copy, and since every refresh issues a
 * new 7-day token it never had to log in again: a deactivated account stayed signed in
 * indefinitely (2026-09-25 FE audit follow-up).
 *
 * Mirrors the plugin's `Service::resolve_status()` exactly
 * (Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-service.php): the
 * meta wins when set, otherwise `user_status` 0 is active and anything else is not.
 */
import { prisma } from '@/lib/db';

export type WpAccountStatus = 'active' | 'inactive' | 'blocked' | 'missing';

export async function findWpAccountStatus(wpUserId: bigint): Promise<WpAccountStatus> {
  const rows = await prisma.$queryRawUnsafe<Array<{ user_status: number | bigint; meta: string | null }>>(
    `SELECT u.user_status,
            (SELECT m.meta_value FROM wp_usermeta m
              WHERE m.user_id = u.ID AND m.meta_key = 'praktiqu_user_status'
              ORDER BY m.umeta_id DESC LIMIT 1) AS meta
       FROM wp_users u
      WHERE u.ID = ?
      LIMIT 1`,
    wpUserId,
  );
  const row = rows[0];
  if (!row) return 'missing';

  const meta = (row.meta ?? '').trim();
  if (meta !== '') {
    return meta === 'active' ? 'active' : meta === 'blocked' ? 'blocked' : 'inactive';
  }
  return Number(row.user_status) === 0 ? 'active' : 'inactive';
}
