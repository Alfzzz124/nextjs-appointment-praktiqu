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
import { resolveKcActor } from '@/services/billing/kc-actor';
import {
  invalidIdResponse,
  parseProfessionalId,
} from '@/services/professional/route-scope';

type RouteParams = { params: { id: string } };

// ============================================
// GET /api/v1/professionals/:id/slots?date=YYYY-MM-DD&serviceId=...
// ============================================

export const GET = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const id = parseProfessionalId(ctx.params.id);
  if (id === null) return invalidIdResponse();
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

  // Slots are per clinic: the doctor's window, price and duration all hang off the
  // clinic mapping, so a clinic is required rather than inferred globally.
  const kc = await resolveKcActor(actor);
  const clinicId = Number(searchParams.get('clinicId') ?? kc.clinicId ?? 0);
  if (!clinicId) {
    return NextResponse.json(
      validationError('missing_clinic_id', 'clinicId is required for this actor'),
      { status: 400 },
    );
  }

  const slots = await generateSlots(id, date, Number(serviceId), clinicId);

  return NextResponse.json({
    professionalId: id,
    date,
    serviceId,
    // Local clinic time, matching how KiviCare stores appointments. The previous shape
    // exposed UTC instants derived from a practice timezone that no longer exists.
    slots: slots.map((s) => ({
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      serviceId: s.serviceId,
      doctorId: s.doctorId,
    })),
  });
});