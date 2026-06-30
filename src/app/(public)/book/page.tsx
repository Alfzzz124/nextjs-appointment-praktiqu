// src/app/(public)/book/page.tsx
// Step 1: Browse professionals
import { WizardLayout } from '@/components/booking/wizard-layout';
import { prisma } from '@/lib/prisma';
import { ProfessionalCard } from '@/components/booking/professional-card';
import { SpecialtyFilter } from '@/components/booking/specialty-filter';

export const dynamic = 'force-dynamic';

interface SearchParams {
  specialty?: string;
}

interface ProfessionalData {
  id: string;
  fullName: string;
  professionalType: string | null;
  biography: string | null;
  specialties: string[];
  nextSlot: string | null;
  nextDate: string | null;
}

async function getWordPressProfessionals(specialty?: string): Promise<ProfessionalData[]> {
  try {
    // Get doctors from WordPress KiviCare tables
    let query = `
      SELECT DISTINCT
        dcm.doctor_id,
        dcm.clinic_id,
        c.name as clinicName,
        c.email as clinicEmail,
        u.display_name as displayName,
        c.specialties
      FROM wp_kc_doctor_clinic_mappings dcm
      JOIN wp_kc_clinics c ON dcm.clinic_id = c.id
      JOIN wp_users u ON dcm.doctor_id = u.ID
      WHERE c.status = 1
      ORDER BY c.name
    `;

    const mappings = await prisma.$queryRawUnsafe<any[]>(query);

    // Get meta data for each doctor
    const result: ProfessionalData[] = [];
    for (const m of mappings.slice(0, 50)) {
      const userId = Number(m.doctor_id);

      const metaResult = await prisma.$queryRawUnsafe<any[]>(`
        SELECT meta_key, meta_value FROM wp_usermeta
        WHERE user_id = ${userId} AND meta_key IN ('first_name', 'last_name', 'doctor_description', 'basic_data')
      `);

      const metaMap: Record<string, string> = {};
      metaResult.forEach(r => { metaMap[r.meta_key] = r.meta_value; });

      let specialties: string[] = [];
      if (m.specialties) {
        try {
          specialties = JSON.parse(m.specialties).map((s: any) => s.label || s);
        } catch {}
      }

      // Filter by specialty if specified
      if (specialty && specialties.length > 0) {
        const hasSpecialty = specialties.some((s: string) =>
          s.toLowerCase().includes(specialty.toLowerCase())
        );
        if (!hasSpecialty) continue;
      }

      const fullName = m.displayName ||
        `${metaMap['first_name'] || ''} ${metaMap['last_name'] || ''}`.trim() ||
        'Professional';

      // Parse basic_data for additional info
      let biography: string | null = null;
      if (metaMap['doctor_description']) {
        // Remove HTML tags from the description
        biography = metaMap['doctor_description'].replace(/<[^>]*>?/gm, '').trim();
      } else if (metaMap['basic_data']) {
        try {
          const basicData = JSON.parse(metaMap['basic_data']);
          if (Array.isArray(basicData.specialties)) {
            // Extract label if it's an object, otherwise use the string directly
            biography = basicData.specialties.map((s: any) => s.label || s).join(', ');
          }
        } catch {}
      }

      result.push({
        id: String(m.doctor_id),
        fullName,
        professionalType: null,
        biography,
        specialties,
        nextSlot: null,
        nextDate: null,
      });
    }

    return result;
  } catch (err) {
    console.error('Error fetching professionals:', err);
    return [];
  }
}

export default async function BookStep1Page({ searchParams }: { searchParams: SearchParams }) {
  const professionals = await getWordPressProfessionals(searchParams.specialty);

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