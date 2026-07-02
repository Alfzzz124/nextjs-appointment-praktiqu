import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** DEPRECATED: use POST /api/v1/public/appointments. */
export async function POST() {
  return NextResponse.json(
    {
      type: 'about:blank',
      title: 'Endpoint moved',
      status: 308,
      detail: 'POST /api/v1/public/booking is deprecated. Use POST /api/v1/public/appointments.',
    },
    { status: 308, headers: { Location: '/api/v1/public/appointments' } },
  );
}
