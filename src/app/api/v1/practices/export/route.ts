/**
 * GET /api/v1/practices/export — export all practices as JSON attachment
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden } from '@/lib/problem-details';
import { exportPractices } from '@/services/practice/service';
import { logging } from '@/lib/logging';

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const { actor } = ctx as any;
  if (!['SUPER_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const rawStatus = searchParams.get('status');
  // Only use status if it's a non-null, non-empty string
  const statusNum = (rawStatus !== null && rawStatus !== '') ? Number(rawStatus) : undefined;
  const params = {
    status: (statusNum !== undefined && !isNaN(statusNum)) ? statusNum : undefined,
  };

  try {
    const rows = await exportPractices(params);
    const json = JSON.stringify(rows, null, 2);
    return new NextResponse(json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="practices-export.json"',
      },
    });
  } catch (err) {
    await logging.error('exportPractices failed', err, { path: '/api/v1/practices/export' });
    return NextResponse.json(
      { type: '/errors/internal', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
});
