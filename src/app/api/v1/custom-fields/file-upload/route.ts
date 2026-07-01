import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { code: 'NOT_IMPLEMENTED', message: 'File upload for custom fields is not yet configured' },
    { status: 501 },
  );
}
