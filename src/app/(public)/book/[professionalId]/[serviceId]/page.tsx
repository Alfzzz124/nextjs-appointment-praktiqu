// src/app/(public)/book/[professionalId]/[serviceId]/page.tsx
// Step 3: Date and time slot selection
import { WizardLayout } from '@/components/booking/wizard-layout';
import { SlotPicker } from '@/components/booking/slot-picker';
import {
  getPublicProfessionalServices,
  getPublicProfessionalSummary,
  getPublicSlotsForRange,
} from '@/services/public/public-catalog.service';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

/** How far ahead the picker offers dates. */
const DAYS_AHEAD = 14;

/** `HH:MM:SS` → `HH:MM`, the shape SlotPicker renders and the hold API expects. */
function hhmm(time: string): string {
  return time.slice(0, 5);
}

/** Local calendar date as `YYYY-MM-DD` — never via an ISO-string conversion, which shifts to UTC. */
function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default async function BookStep3Page({
  params,
}: {
  params: { professionalId: string; serviceId: string };
}) {
  const professionalId = Number(params.professionalId);
  const serviceId = Number(params.serviceId);

  const today = new Date();
  const from = localDate(today);
  const last = new Date(today);
  last.setDate(last.getDate() + DAYS_AHEAD - 1);
  const to = localDate(last);

  const [professional, services, days] = await Promise.all([
    getPublicProfessionalSummary(professionalId),
    getPublicProfessionalServices(professionalId),
    getPublicSlotsForRange({ professionalId, serviceId, from, to }),
  ]);

  const service = services?.find((s) => s.id === serviceId) ?? null;

  // One guard for all three cases. An unknown professional, an inactive one, and a
  // service they do not offer publicly all render the same card the page showed
  // before.
  if (!professional || !service || !days) {
    return (
      <WizardLayout currentStep={3}>
        <div className="card text-center text-sm text-[#777587]">Layanan tidak ditemukan.</div>
      </WizardLayout>
    );
  }

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
          {service.name} dengan <strong>{professional.fullName}</strong> ({service.durationMinutes ?? 60} menit)
        </p>
      </div>
      <SlotPicker
        professionalId={params.professionalId}
        serviceId={params.serviceId}
        days={days.map((d) => ({
          date: d.date,
          slots: d.slots.map((s) => ({
            startTime: hhmm(s.startTime),
            endTime: hhmm(s.endTime),
            startUtc: `${d.date}T${s.startTime}`,
          })),
        }))}
      />
    </WizardLayout>
  );
}
