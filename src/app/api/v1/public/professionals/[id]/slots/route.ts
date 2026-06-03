// src/app/api/v1/public/professionals/[id]/slots/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateSlots } from '@/services/booking/slot-generator';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(req.url);
  const dateStr = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  const serviceId = searchParams.get('serviceId') ?? undefined;

  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Invalid date', status: 400 },
        { status: 400 },
      );
    }

    const [availability, service, existingAppts] = await Promise.all([
      prisma.professionalAvailability.findMany({ where: { professionalId: params.id } }),
      serviceId
        ? prisma.service.findUnique({ where: { id: serviceId } })
        : Promise.resolve(null),
      prisma.appointment.findMany({
        where: {
          doctorId: params.id,
          appointmentStartDate: date,
          status: { in: ['PENDING', 'BOOKED', 'CHECK_IN', 'CHECK_OUT'] },
        },
      }),
    ]);

    const duration = service?.duration ?? 60;
    const slots = generateSlots({
      date,
      duration,
      availability: availability.map((a) => ({
        dayOfWeek: a.dayOfWeek,
        startMinute: a.startMinute,
        endMinute: a.endMinute,
      })),
      existingBookings: existingAppts
        .filter((a) => a.appointmentStartUtc)
        .map((a) => ({
          startUtc: a.appointmentStartUtc!,
          endUtc: a.appointmentEndUtc ?? a.appointmentStartUtc!,
        })),
    });

    return NextResponse.json({
      date: dateStr,
      duration,
      slots: slots.map((s) => ({
        startTime: s.startTime,
        endTime: s.endTime,
        startUtc: s.startUtc.toISOString(),
        endUtc: s.endUtc.toISOString(),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}