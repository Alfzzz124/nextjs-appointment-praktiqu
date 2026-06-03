// src/app/(public)/book/[professionalId]/service/page.tsx
// Step 2: Service selection
import { WizardLayout } from '@/components/booking/wizard-layout';
import { ServiceCard } from '@/components/booking/service-card';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

async function getData(professionalId: string) {
  try {
    const [professional, mappings] = await Promise.all([
      prisma.professional.findUnique({
        where: { id: professionalId },
        include: { user: { select: { displayName: true } } },
      }),
      prisma.doctorServiceMapping.findMany({
        where: { doctorId: professionalId },
        include: { service: true },
      }),
    ]);
    return { professional, services: mappings.filter((m) => m.service.status === 1).map((m) => ({
      id: m.service.id,
      name: m.service.name,
      description: m.service.description,
      duration: m.service.duration,
      price: m.price ?? m.service.price,
    })) };
  } catch {
    return { professional: null, services: [] };
  }
}

export default async function BookStep2Page({ params }: { params: { professionalId: string } }) {
  const { professional, services } = await getData(params.professionalId);

  if (!professional) {
    return (
      <WizardLayout currentStep={2}>
        <div className="card text-center text-sm text-[#777587]">Profesional tidak ditemukan.</div>
      </WizardLayout>
    );
  }

  return (
    <WizardLayout currentStep={2}>
      <div className="mb-6">
        <Link href="/book" className="text-sm text-[#464555] hover:text-[#3625cd]">
          ← Kembali ke daftar profesional
        </Link>
      </div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1b1b24]">Pilih Layanan</h1>
        <p className="mt-1 text-sm text-[#464555]">
          Layanan yang ditawarkan oleh <strong>{professional.fullName}</strong>
        </p>
      </div>
      {services.length === 0 ? (
        <div className="card text-center text-sm text-[#777587]">
          Belum ada layanan yang tersedia untuk profesional ini.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {services.map((s) => (
            <ServiceCard
              key={s.id}
              service={s}
              professionalId={params.professionalId}
            />
          ))}
        </div>
      )}
    </WizardLayout>
  );
}