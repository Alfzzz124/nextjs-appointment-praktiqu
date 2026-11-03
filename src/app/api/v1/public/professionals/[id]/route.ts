// One active professional, in the same shape as an entry of the public directory.
import { NextRequest, NextResponse } from 'next/server';
import { getPublicProfessional } from '@/services/public/public-catalog.service';
import { notFound, problemHeaders } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

function professionalNotFound(): NextResponse {
  const p = notFound('professional_not_found', 'No active professional with that id');
  return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  // A wp_users.ID, written as plain digits. Checked as a string first because Number()
  // alone also accepts '1e3', '0x10' and ' 7 ', none of which is an id anyone was given.
  // Anything else is a 404 rather than a NaN query — including `/professionals/by-slug`
  // with the slug left off, which lands on this route.
  const id = /^[0-9]+$/.test(params.id) ? Number(params.id) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) return professionalNotFound();

  try {
    const professional = await getPublicProfessional(id);
    if (!professional) return professionalNotFound();
    return NextResponse.json({ data: professional });
  } catch (err) {
    console.error('[public/professionals/id] error:', err);
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
