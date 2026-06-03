// src/app/(public)/book/[professionalId]/[serviceId]/page.tsx
// Step 3: Date and time slot selection
import { WizardLayout } from '@/components/booking/wizard-layout';
import { prisma } from '@/lib/prisma';
import { generateSlots } from '@/services/booking/slot-generator';
import { SlotPicker } from '@/components/booking/slot-picker';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

async function getData(professionalId: string, serviceId: string) {
  try {
    const [professional, service, availability, existingAppts] = await Promise.all([
      prisma.professional.findUnique({ where: { id: professionalId } }),
      prisma.service.findUnique({ where: { id: serviceId } }),
      prisma.professionalAvailability.findMany({ where: { professionalId } }),
      prisma.appointment.findMany({
        where: {
          doctorId: professionalId,
          status: { in: ['PENDING', 'BOOKED', 'CHECK_IN', 'CHECK_OUT'] },
        },
      }),
    ]);
    return { professional, service, availability, existingAppts };
  } catch {
    return { professional: null, service: null, availability: [], existingAppts: [] };
  }
}

export default async function BookStep3Page({
  params,
}: {
  params: { professionalId: string; serviceId: string };
}) {
  const { professional, service, availability, existingAppts } = await getData(
    params.professionalId,
    params.serviceId,
  );

  if (!professional || !service) {
    return (
      <WizardLayout currentStep={3}>
        <div className="card text-center text-sm text-[#777587]">Layanan tidak ditemukan.</div>
      </WizardLayout>
    );
  }

  const duration = service.duration;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });

  const daySlots = days.map((date) => {
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
    return { date, slots };
  });

  return (
    <WizardLayout currentStep={3}>
      <div className="mb-6">
        <Link
          href={`/book/${params.professionalId}/service`}
          className="text-sm text-[#464555] hover:text-[#3625cd]"
        >
          ← Kembali pilih layanan
        </Link>
      </div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1b1b24]">Pilih Jadwal</h1>
        <p className="mt-1 text-sm text-[#464555]">
          {service.name} dengan <strong>{professional.fullName}</strong> ({duration} menit)
        </p>
      </div>
      <SlotPicker
        professionalId={params.professionalId}
        serviceId={params.serviceId}
        days={daySlots.map((d) => ({
          date: d.date.toISOString().slice(0, 10),
          slots: d.slots.map((s) => ({
            startTime: s.startTime,
            endTime: s.endTime,
            startUtc: s.startUtc.toISOString(),
          })),
        }))}
      />
    </WizardLayout>
  );
}