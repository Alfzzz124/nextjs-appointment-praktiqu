// Resolve a personal booking link (terpadu.praktiqu.com/{slug}) to its professional.
//
// A static `by-slug` segment rather than a query on the directory: `/professionals/{id}`
// already owns the dynamic segment at this level, and Next matches static segments
// before dynamic ones, so `/professionals/by-slug/x` can never be read as an id.
import { NextRequest, NextResponse } from 'next/server';
import { findPublicProfessionalBySlug } from '@/services/public/public-catalog.service';
import { notFound, problemHeaders } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    // Next has already percent-decoded the segment; the service normalises it with the
    // FE's slugify, and one that normalises to nothing is a 404 without a query.
    const professional = await findPublicProfessionalBySlug(params.slug);
    if (!professional) {
      const p = notFound('professional_not_found', 'No active professional with that link');
      return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
    }
    return NextResponse.json({ data: professional });
  } catch (err) {
    console.error('[public/professionals/by-slug] error:', err);
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
