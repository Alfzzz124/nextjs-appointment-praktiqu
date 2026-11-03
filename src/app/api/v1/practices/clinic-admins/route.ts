/**
 * GET /api/v1/practices/clinic-admins — every account that can be made a clinic's admin.
 *
 * SUPER_ADMIN only. Read from WordPress (wp_users + the kiviCare_clinic_admin capability),
 * not from the auth `users` table: an admin created in KiviCare has no `users` row until
 * their first login, and must still be offered. The static segment wins over `[id]`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRoles } from '@/lib/auth/route-guards';
import { listClinicAdmins } from '@/repositories/wp/clinic-admins.repo';
import { logging } from '@/lib/logging';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN']);
  if ('response' in gate) return gate.response;

  try {
    const data = await listClinicAdmins();
    return NextResponse.json({ data, total: data.length }, { status: 200 });
  } catch (err) {
    await logging.error('listClinicAdmins failed', err, { path: '/api/v1/practices/clinic-admins' });
    return NextResponse.json(
      { type: '/errors/internal', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
