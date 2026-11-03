/**
 * Error → HTTP answer for the approval routes, in the shapes the sessions/* routes use:
 * AuthError as the auth problem, zod as 422, anything carrying code + status (ApprovalError,
 * SessionServiceError) as its own problem, everything else 500. KcError carries
 * `httpStatus` and no `code`, so it is not matched and lands in the 500 too.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError } from '@/lib/auth';
import { unauthorized } from '@/lib/problem-details';

export function approvalErrorResponse(err: unknown, tag: string): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json(unauthorized('unauthorized', err.message), {
      status: err.status,
      headers: { 'Content-Type': 'application/problem+json' },
    });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { type: '/errors/validation-error', title: 'Validation Error', status: 422, detail: err.message, errors: err.errors },
      { status: 422 },
    );
  }
  if (err && typeof err === 'object' && 'code' in err && 'status' in err) {
    const e = err as { code: string; status: number; message: string };
    return NextResponse.json(
      { type: `/errors/${e.code}`, title: e.code, status: e.status, detail: e.message },
      { status: e.status },
    );
  }
  console.error(tag, err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
