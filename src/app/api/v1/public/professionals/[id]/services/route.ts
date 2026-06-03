// src/app/api/v1/public/professionals/[id]/services/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const services = await prisma.doctorServiceMapping.findMany({
      where: { doctorId: params.id },
      include: { service: true },
    });
    const items = services
      .filter((m) => m.service.status === 1)
      .map((m) => ({
        id: m.service.id,
        name: m.service.name,
        description: m.service.description,
        duration: m.service.duration,
        price: m.price ?? m.service.price,
      }));
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}