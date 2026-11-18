import { NextRequest, NextResponse } from 'next/server';
import { CustomFieldService } from '@/services/custom-fields/service';
import { withAuth } from '@/lib/auth';
import { forbidden } from '@/lib/problem-details';

const service = new CustomFieldService();

export const POST = withAuth(async (req, ctx) => {
  const { actor } = ctx;
  // No clinic column: one definition serves every clinic, so only SUPER_ADMIN may change it.
  if (actor.role !== 'SUPER_ADMIN') {
    return NextResponse.json(forbidden(), { status: 403 });
  }
  try {
    const body = await req.json();
    const { ids, status } = body;
    if (!Array.isArray(ids) || status === undefined) {
      return NextResponse.json({ type: 'about:blank', title: 'Bad Request', status: 400 }, { status: 400 });
    }
    const updated = await service.bulkSetCustomFieldStatus(ids, Number(status));
    return NextResponse.json({ updated });
  } catch {
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
});
