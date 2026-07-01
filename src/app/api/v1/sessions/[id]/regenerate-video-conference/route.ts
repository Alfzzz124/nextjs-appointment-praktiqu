/**
 * POST /api/v1/sessions/:id/regenerate-video-conference — video conference stub
 *
 * Not yet implemented — video conference integration pending.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    { status: false, message: 'Video conference integration not yet configured.' },
    { status: 501 },
  );
}
