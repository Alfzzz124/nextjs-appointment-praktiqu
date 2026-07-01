/**
 * GET /api/v1/practices/:id/users — list users associated with a practice
 */
import { NextRequest, NextResponse } from 'next/server';
import { listPracticeUsers, PracticeNotFoundError } from '@/services/practice/service';
import { logging } from '@/lib/logging';

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const users = await listPracticeUsers(params.id);
    return NextResponse.json({ data: users }, { status: 200 });
  } catch (err) {
    if (err instanceof PracticeNotFoundError) {
      return NextResponse.json(
        { type: '/errors/resource-not-found', title: 'Practice not found', status: 404 },
        { status: 404 },
      );
    }
    await logging.error('listPracticeUsers failed', err, { path: `/api/v1/practices/${params.id}/users` });
    return NextResponse.json(
      { type: '/errors/internal', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
