// src/app/api/v1/public/professionals/route.ts
// Public listing of active professionals with next available slot.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateSlots } from '@/services/booking/slot-generator';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const specialty = searchParams.get('specialty') ?? undefined;

  try {
    const professionals = await prisma.professional.findMany({
      where: {
        status: 'ACTIVE' as any,
        ...(specialty
          ? { specialties: { array_contains: specialty } as any }
          : {}),
      },
      include: {
        user: { select: { id: true, displayName: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Compute next available slot for each professional (best-effort)
    const now = new Date();
    const items = await Promise.all(
      professionals.map(async (p) => {
        let nextAvailable: string | null = null;
        try {
          const availability = await prisma.professionalAvailability.findMany({
            where: { professionalId: p.id },
          });
          const duration = 60;
          for (let i = 0; i < 14 && !nextAvailable; i++) {
            const d = new Date(now);
            d.setDate(d.getDate() + i);
            d.setHours(0, 0, 0, 0);
            const slots = generateSlots({
              date: d,
              duration,
              availability: availability.map((a) => ({
                dayOfWeek: a.dayOfWeek,
                startMinute: a.startMinute,
                endMinute: a.endMinute,
              })),
              existingBookings: [],
            });
            if (slots.length > 0) {
              nextAvailable = slots[0].startTime;
            }
          }
        } catch {
          // ignore — best-effort
        }
        return {
          id: p.id,
          fullName: p.fullName,
          professionalType: p.professionalType,
          biography: p.biography,
          specialties: p.specialties,
          nextAvailable,
        };
      }),
    );

    return NextResponse.json({ items });
  } catch (err) {
    console.error('[public/professionals] error:', err);
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}