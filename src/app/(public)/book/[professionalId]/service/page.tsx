// src/app/(public)/book/[professionalId]/service/page.tsx
// Step 2: Service selection
import { WizardLayout } from '@/components/booking/wizard-layout';
import { ServiceCard } from '@/components/booking/service-card';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface ServiceData {
  id: string;
  name: string;
  description: string | null;
  duration: number;
  price: any;
}

interface ProfessionalData {
  id: string;
  fullName: string;
}

async function getData(professionalId: string) {
  try {
    // Get professional info from WordPress
    const userResult = await prisma.$queryRawUnsafe<any[]>(`
      SELECT u.ID, u.display_name, c.name as clinic_name
      FROM wp_users u
      JOIN wp_kc_doctor_clinic_mappings dcm ON u.ID = dcm.doctor_id
      JOIN wp_kc_clinics c ON dcm.clinic_id = c.id
      WHERE u.ID = ${parseInt(professionalId)}
      LIMIT 1
    `);

    if (!userResult || userResult.length === 0) {
      return { professional: null, services: [] };
    }

    const professional: ProfessionalData = {
      id: String(userResult[0].ID),
      fullName: userResult[0].display_name || 'Professional',
    };

    // Get services from WordPress
    const servicesRaw = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        s.id,
        s.name,
        s.type,
        s.category,
        s.price,
        sdm.charges,
        sdm.duration,
        sdm.telemed_service,
        sdm.service_name_alias
      FROM wp_kc_service_doctor_mapping sdm
      JOIN wp_kc_services s ON sdm.service_id = s.id
      WHERE sdm.doctor_id = ${parseInt(professionalId)}
        AND sdm.status = 1
        AND s.status = 1
      ORDER BY s.name
    `);

    // Deduplicate by service id
    const seen = new Set<number>();
    const services: ServiceData[] = [];
    for (const s of servicesRaw) {
      if (seen.has(Number(s.id))) continue;
      seen.add(Number(s.id));

      services.push({
        id: String(s.id),
        name: s.service_name_alias || s.name,
        description: s.category || null,
        duration: s.duration || 60,
        price: s.charges || s.price || '0',
      });
    }

    return { professional, services };
  } catch (err) {
    console.error('Error in getData:', err);
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