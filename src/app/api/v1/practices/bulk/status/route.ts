/**
 * POST /api/v1/practices/bulk/status — set status on multiple practices
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { bulkSetPracticeStatus } from '@/services/practice/service';
import { logging } from '@/lib/logging';

const schema = z.object({
  ids: z.array(z.string()).min(1),
  status: z.union([z.literal(0), z.literal(1)]),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { type: '/errors/bad-request', title: 'Invalid JSON', status: 400 },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        type: '/errors/validation-error',
        title: 'Validation Error',
        status: 422,
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 422 },
    );
  }

  try {
    const count = await bulkSetPracticeStatus(parsed.data.ids, parsed.data.status);
    return NextResponse.json(
      { message: 'Practice statuses updated', data: { updated: count } },
      { status: 200 },
    );
  } catch (err) {
    await logging.error('bulkSetPracticeStatus failed', err, { path: '/api/v1/practices/bulk/status' });
    return NextResponse.json(
      { type: '/errors/internal', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
