/**
 * GET /api/v1/service-categories — the `service_type` vocabulary.
 *
 * `categoryId` on POST /api/v1/services points at one of these rows. Every logged-in
 * role may read it: it is a lookup list with no clinic dimension.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { listServiceTypes } from '@/repositories/wp/static-data.repo';

export const GET = withAuth(async () => {
  const rows = await listServiceTypes();

  return NextResponse.json({
    categories: rows.map((r) => ({
      id: Number(r.id),
      label: r.label,
      value: r.value,
    })),
  });
});
