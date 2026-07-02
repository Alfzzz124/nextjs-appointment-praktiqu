/**
 * POST /api/v1/auth/reset-password
 *
 * Stub — password reset via email is not yet configured.
 * Returns 501 Not Implemented.
 */

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { code: 'NOT_IMPLEMENTED', message: 'Password reset via email is not yet configured' },
    { status: 501 },
  );
}
