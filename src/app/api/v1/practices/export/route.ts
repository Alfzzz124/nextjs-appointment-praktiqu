/**
 * GET /api/v1/practices/export — export all practices as JSON attachment
 */
import { NextRequest, NextResponse } from 'next/server';
import { exportPractices } from '@/services/practice/service';
import { logging } from '@/lib/logging';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const statusParam = searchParams.get('status');
  const status = statusParam !== null ? Number(statusParam) : undefined;

  try {
    const rows = await exportPractices({ status });
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
}
