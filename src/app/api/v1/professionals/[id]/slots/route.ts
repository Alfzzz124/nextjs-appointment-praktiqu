/**
 * GET /api/v1/professionals/[id]/slots — get bookable slots for date + service
 *
 * T017: Slot query endpoint
 * Public endpoint — all authenticated users can query slots
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { validationError, notFound } from '@/lib/problem-details';
import { generateSlots } from '@/services/professional/availability.service';
import { slotQuerySchema } from '@/services/professional/validation';
import type { Actor } from '@/lib/auth';

type RouteParams = { params: { id: string } };

// ============================================
// GET /api/v1/professionals/:id/slots?date=YYYY-MM-DD&serviceId=...
// ============================================

export const GET = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { id } = ctx.params;
  const { searchParams } = req.nextUrl;

  const date = searchParams.get('date');
  const serviceId = searchParams.get('serviceId');

  if (!date || !serviceId) {
    return NextResponse.json(
      validationError('missing_params', 'Both date and serviceId query params are required'),
      { status: 400 },
    );
  }

  const parsed = slotQuerySchema.safeParse({ date, serviceId });
  if (!parsed.success) {
    return NextResponse.json(
      validationError('invalid_params', 'Invalid date or serviceId format', undefined, parsed.error.flatten().fieldErrors as Record<string, string[]>),
      { status: 400 },
    );
  }

  const slots = await generateSlots(id, date, serviceId);

  return NextResponse.json({
    professionalId: id,
    date,
    serviceId,
    slots: slots.map((s) => ({
      startUtc: s.startUtc.toISOString(),
      endUtc: s.endUtc.toISOString(),
      serviceId: s.serviceId,
      professionalId: s.professionalId,
    })),
  });
});