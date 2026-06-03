// src/app/api/v1/public/booking/hold/route.ts
// Create a 15-min hold for a slot, or GET the remaining time.
import { NextRequest, NextResponse } from 'next/server';
import { slotHoldService } from '@/services/booking/slot-hold.service';
import { z } from 'zod';

const holdSchema = z.object({
  professionalId: z.string().min(1),
  serviceId: z.string().min(1),
  date: z.string().min(1),
  startTime: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = holdSchema.parse(body);
    const key = slotHoldService.buildKey(
      parsed.professionalId,
      parsed.serviceId,
      parsed.date,
      parsed.startTime,
    );
    const hold = slotHoldService.create({
      professionalId: parsed.professionalId,
      serviceId: parsed.serviceId,
      date: parsed.date,
      startTime: parsed.startTime,
      key,
    });
    return NextResponse.json({ holdKey: hold.key, expiresAt: hold.expiresAt }, { status: 201 });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return NextResponse.json(
        { type: 'about:blank', title: 'Validation failed', status: 400, errors: err.errors },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key') ?? '';
  const data = slotHoldService.getWithRemaining(key);
  if (!data) {
    return NextResponse.json(
      { type: 'about:blank', title: 'Hold expired or not found', status: 410 },
      { status: 410 },
    );
  }
  return NextResponse.json({ remainingSec: data.remainingSec, expiresAt: data.hold.expiresAt });
}