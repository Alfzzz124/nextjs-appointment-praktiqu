// src/app/(public)/book/confirmation/page.tsx
// Step 5: Booking confirmation
import { WizardLayout } from '@/components/booking/wizard-layout';
import { Confirmation } from '@/components/booking/confirmation';
import Link from 'next/link';

interface SearchParams {
  id?: string;
  professional?: string;
  service?: string;
  date?: string;
  startTime?: string;
}

export default function BookStep5Page({ searchParams }: { searchParams: SearchParams }) {
  if (!searchParams.id) {
    return (
      <WizardLayout currentStep={5}>
        <div className="card text-center text-sm text-[#777587]">
          Konfirmasi tidak ditemukan.{' '}
          <Link href="/book" className="text-[#3625cd] underline">
            Mulai booking baru
          </Link>
        </div>
      </WizardLayout>
    );
  }

  return (
    <WizardLayout currentStep={5}>
      <Confirmation
        bookingId={searchParams.id}
        professionalName={searchParams.professional ?? ''}
        serviceName={searchParams.service ?? ''}
        date={searchParams.date ?? ''}
        startTime={searchParams.startTime ?? ''}
      />
    </WizardLayout>
  );
}