// src/app/(public)/book/[professionalId]/[serviceId]/confirm/page.tsx
// Step 4: Client information + login/register
import { WizardLayout } from '@/components/booking/wizard-layout';
import { BookingForm } from '@/components/booking/booking-form';
import { HoldCountdown } from '@/components/booking/hold-countdown';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

async function getData(professionalId: string, serviceId: string) {
  try {
    const [professional, service] = await Promise.all([
      prisma.professional.findUnique({ where: { id: professionalId } }),
      prisma.service.findUnique({ where: { id: serviceId } }),
    ]);
    return { professional, service };
  } catch {
    return { professional: null, service: null };
  }
}

export default async function BookStep4Page({
  params,
  searchParams,
}: {
  params: { professionalId: string; serviceId: string };
  searchParams: { holdKey?: string; date?: string; startTime?: string; endTime?: string };
}) {
  const { professional, service } = await getData(params.professionalId, params.serviceId);
  const { holdKey, date, startTime, endTime } = searchParams;

  if (!professional || !service) {
    return (
      <WizardLayout currentStep={4}>
        <div className="card text-center text-sm text-[#777587]">Layanan tidak ditemukan.</div>
      </WizardLayout>
    );
  }
  if (!holdKey || !date || !startTime) {
    return (
      <WizardLayout currentStep={4}>
        <div className="card text-center text-sm text-[#777587]">
          Sesi booking tidak valid. <Link href="/book" className="text-[#3625cd] underline">Mulai ulang</Link>.
        </div>
      </WizardLayout>
    );
  }

  return (
    <WizardLayout currentStep={4}>
      <div className="mb-6">
        <Link
          href={`/book/${params.professionalId}/${params.serviceId}`}
          className="text-sm text-[#464555] hover:text-[#3625cd]"
        >
          ← Kembali pilih jadwal
        </Link>
      </div>
      <div className="grid gap-8 md:grid-cols-3">
        <div className="md:col-span-2">
          <h1 className="text-2xl font-bold text-[#1b1b24]">Data Diri Anda</h1>
          <p className="mt-1 text-sm text-[#464555]">
            Masukkan data diri untuk menyelesaikan booking. Sudah punya akun?{' '}
            <Link href="/login?next=/book" className="font-semibold text-[#3625cd] hover:underline">
              Masuk di sini
            </Link>
          </p>
          <HoldCountdown holdKey={holdKey} startTime={startTime} endTime={endTime ?? ''} />
          <BookingForm
            professionalId={params.professionalId}
            serviceId={params.serviceId}
            holdKey={holdKey}
            date={date}
            startTime={startTime}
            endTime={endTime ?? ''}
          />
        </div>
        <aside className="card h-fit md:sticky md:top-6">
          <h3 className="text-sm font-semibold text-[#1b1b24]">Ringkasan Booking</h3>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wider text-[#777587]">Profesional</dt>
              <dd className="font-medium text-[#1b1b24]">{professional.fullName}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-[#777587]">Layanan</dt>
              <dd className="font-medium text-[#1b1b24]">{service.name}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-[#777587]">Tanggal</dt>
              <dd className="font-medium text-[#1b1b24]">
                {new Date(date).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-[#777587]">Waktu</dt>
              <dd className="font-medium text-[#1b1b24]">{startTime}{endTime ? ` – ${endTime}` : ''}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-[#777587]">Durasi</dt>
              <dd className="font-medium text-[#1b1b24]">{service.duration} menit</dd>
            </div>
          </dl>
        </aside>
      </div>
    </WizardLayout>
  );
}