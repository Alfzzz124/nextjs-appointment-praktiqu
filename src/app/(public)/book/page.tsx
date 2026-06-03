// src/app/(public)/book/page.tsx
// Step 1: Browse professionals
import { WizardLayout } from '@/components/booking/wizard-layout';
import { prisma } from '@/lib/prisma';
import { generateSlots } from '@/services/booking/slot-generator';
import { ProfessionalCard } from '@/components/booking/professional-card';
import { SpecialtyFilter } from '@/components/booking/specialty-filter';

export const dynamic = 'force-dynamic';

interface SearchParams {
  specialty?: string;
}

async function getProfessionals(specialty?: string) {
  try {
    const professionals = await prisma.professional.findMany({
      where: {
        status: 'ACTIVE' as any,
        ...(specialty ? { specialties: { array_contains: specialty } as any } : {}),
      },
      include: {
        user: { select: { id: true, displayName: true, firstName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Compute next available
    const now = new Date();
    return Promise.all(
      professionals.map(async (p) => {
        let nextSlot: string | null = null;
        let nextDate: string | null = null;
        try {
          const availability = await prisma.professionalAvailability.findMany({
            where: { professionalId: p.id },
          });
          for (let i = 0; i < 14 && !nextSlot; i++) {
            const d = new Date(now);
            d.setDate(d.getDate() + i);
            d.setHours(0, 0, 0, 0);
            const slots = generateSlots({
              date: d,
              duration: 60,
              availability: availability.map((a) => ({
                dayOfWeek: a.dayOfWeek,
                startMinute: a.startMinute,
                endMinute: a.endMinute,
              })),
              existingBookings: [],
            });
            if (slots.length > 0) {
              nextSlot = slots[0].startTime;
              nextDate = d.toISOString().slice(0, 10);
            }
          }
        } catch {}
        return {
          id: p.id,
          fullName: p.fullName,
          professionalType: p.professionalType,
          biography: p.biography,
          specialties: (p.specialties as string[] | null) ?? [],
          nextSlot,
          nextDate,
        };
      }),
    );
  } catch {
    return [];
  }
}

export default async function BookStep1Page({ searchParams }: { searchParams: SearchParams }) {
  const professionals = await getProfessionals(searchParams.specialty);

  return (
    <WizardLayout currentStep={1}>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1b1b24]">Pilih Profesional</h1>
        <p className="mt-1 text-sm text-[#464555]">
          Pilih psikolog, psikiater, atau konselor yang sesuai dengan kebutuhan Anda
        </p>
      </div>
      <SpecialtyFilter active={searchParams.specialty} />
      {professionals.length === 0 ? (
        <div className="card text-center text-sm text-[#777587]">
          Tidak ada profesional yang tersedia saat ini.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {professionals.map((p) => (
            <ProfessionalCard key={p.id} professional={p} />
          ))}
        </div>
      )}
    </WizardLayout>
  );
}