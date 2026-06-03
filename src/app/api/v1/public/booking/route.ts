// src/app/api/v1/public/booking/route.ts
// Public booking submission. Validates slot hold, creates session as PENDING.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { slotHoldService } from '@/services/booking/slot-hold.service';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const publicBookingSchema = z.object({
  professionalId: z.string().min(1),
  serviceId: z.string().min(1),
  date: z.string().min(1),
  startTime: z.string().min(1),
  clientName: z.string().min(1).max(255),
  clientEmail: z.string().email(),
  clientMobile: z.string().min(1).max(32),
  notes: z.string().max(1000).optional(),
  holdKey: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = publicBookingSchema.parse(body);

    // Verify slot hold is still active
    const hold = slotHoldService.get(parsed.holdKey);
    if (!hold) {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Slot hold expired',
          status: 410,
          detail: 'Slot no longer available — please select another time',
        },
        { status: 410 },
      );
    }

    // Atomic-ish: try to create a PENDING appointment
    const startDate = new Date(parsed.date);
    const [hh, mm] = parsed.startTime.split(':').map(Number);
    const startUtc = new Date(startDate);
    startUtc.setHours(hh, mm, 0, 0);
    const service = await prisma.service.findUnique({ where: { id: parsed.serviceId } });
    const duration = service?.duration ?? 60;
    const endUtc = new Date(startUtc.getTime() + duration * 60_000);

    // Check for double-booking
    const conflict = await prisma.appointment.findFirst({
      where: {
        doctorId: parsed.professionalId,
        status: { in: ['PENDING', 'BOOKED', 'CHECK_IN', 'CHECK_OUT'] },
        appointmentStartUtc: { lt: endUtc },
        OR: [
          { appointmentEndUtc: { gt: startUtc } },
          { appointmentStartUtc: { gte: startUtc, lt: endUtc } },
        ],
      },
    });
    if (conflict) {
      slotHoldService.consume(parsed.holdKey);
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Slot no longer available',
          status: 409,
        },
        { status: 409 },
      );
    }

    // Create or get patient record (lightweight — link by email)
    let patient = await prisma.patient.findFirst({
      where: { user: { email: parsed.clientEmail } },
    });
    if (!patient) {
      // Create a minimal User+Patient for guest registration
      const tempUser = await prisma.user.create({
        data: {
          email: parsed.clientEmail,
          username: parsed.clientEmail.split('@')[0],
          firstName: parsed.clientName.split(' ')[0] ?? parsed.clientName,
          lastName: parsed.clientName.split(' ').slice(1).join(' ') || '-',
          displayName: parsed.clientName,
          role: 'CLIENT' as any,
        },
      });
      patient = await prisma.patient.create({
        data: { userId: tempUser.id, status: 1 },
      });
    }

    // Find or default clinic
    const clinic = await prisma.clinic.findFirst();
    if (!clinic) {
      return NextResponse.json(
        { type: 'about:blank', title: 'No clinic configured', status: 500 },
        { status: 500 },
      );
    }

    const appointment = await prisma.appointment.create({
      data: {
        clinicId: clinic.id,
        doctorId: parsed.professionalId,
        patientId: patient.id,
        appointmentStartDate: startDate,
        appointmentStartTime: parsed.startTime,
        appointmentStartUtc: startUtc,
        appointmentEndUtc: endUtc,
        status: 'PENDING' as any,
        description: parsed.notes,
        visitType: 'IN_PERSON' as any,
        services: {
          create: { serviceId: parsed.serviceId, price: service?.price ?? 0 },
        },
      },
      include: { services: { include: { service: true } }, patient: { include: { user: true } }, doctor: { include: { user: true } } },
    });

    // Consume the hold
    slotHoldService.consume(parsed.holdKey);

    return NextResponse.json(
      {
        id: appointment.id,
        status: appointment.status,
        date: parsed.date,
        startTime: parsed.startTime,
        service: service?.name,
        professionalName: appointment.doctor?.user?.displayName,
        clientName: appointment.patient?.user?.displayName,
      },
      { status: 201 },
    );
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