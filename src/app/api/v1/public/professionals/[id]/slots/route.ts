// src/app/api/v1/public/professionals/[id]/slots/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AppointmentStatus } from '@prisma/client';
import { generateSlots } from '@/services/booking/slot-generator';
import { notFound } from '@/lib/problem-details';

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

    const professional = await prisma.professional.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true, status: true },
    });
    if (!professional || professional.status !== 'ACTIVE') {
      const p = notFound('professional_not_found', 'No active professional with that id');
      return NextResponse.json(p, { status: p.status });
    }

    // Appointments are keyed by Doctor id — bridge by shared userId
    // (same as feature-002 availability.service.getBookedRanges).
    const doctor = await prisma.doctor.findUnique({
      where: { userId: professional.userId },
      select: { id: true },
    });

    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
    const [availability, service, existingAppts] = await Promise.all([
      prisma.professionalAvailability.findMany({ where: { professionalId: professional.id } }),
      serviceId
        ? prisma.service.findUnique({ where: { id: serviceId } })
        : Promise.resolve(null),
      doctor
        ? prisma.appointment.findMany({
            where: {
              doctorId: doctor.id,
              appointmentStartDate: dayStart,
              status: {
                in: [
                  AppointmentStatus.PENDING,
                  AppointmentStatus.BOOKED,
                  AppointmentStatus.CHECK_IN,
                ],
              },
            },
          })
        : Promise.resolve([]),
    ]);

    // durationMinutes is the canonical duration (what /services advertises);
    // `duration` is the legacy free-form field.
    const duration = service?.durationMinutes ?? 60;
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
    console.error('[public/professionals/slots] error:', err);
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
