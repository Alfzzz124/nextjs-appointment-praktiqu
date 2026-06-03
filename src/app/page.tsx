// src/app/page.tsx
// PraktiQU public landing page.
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { BookingWizardSteps } from '@/components/booking/wizard-step-indicator';

export const dynamic = 'force-dynamic';

// Types for WordPress/KiviCare data
interface KiviCareDoctor {
  doctorId: string;
  clinicId: string;
  clinicName: string;
  clinicEmail: string;
  displayName: string;
  firstName: string;
  lastName: string;
  specialties: string[];
  description: string | null;
}

interface KiviCareService {
  id: string;
  name: string;
  category: string | null;
  price: number;
  duration: number | null;
  telemedService: boolean;
  clinicId: string;
  clinicName: string;
}

// Fetch professionals from WordPress KiviCare tables
async function getWordPressProfessionals(): Promise<KiviCareDoctor[]> {
  try {
    // Get doctors from doctor_clinic_mapping joined with clinics
    const mappings = await prisma.$queryRawUnsafe<any[]>(`
      SELECT DISTINCT
        dcm.doctor_id,
        dcm.clinic_id,
        c.name as clinicName,
        c.email as clinicEmail,
        u.display_name as displayName,
        u.user_email as email,
        c.specialties
      FROM wp_kc_doctor_clinic_mappings dcm
      JOIN wp_kc_clinics c ON dcm.clinic_id = c.id
      JOIN wp_users u ON dcm.doctor_id = u.ID
      WHERE c.status = 1
      ORDER BY c.name
      LIMIT 6
    `);

    // Get additional meta data in separate queries
    const result: KiviCareDoctor[] = [];
    for (const m of mappings) {
      const userId = Number(m.doctor_id);

      // Get first_name and last_name
      const metaResult = await prisma.$queryRawUnsafe<any[]>(`
        SELECT meta_key, meta_value FROM wp_usermeta
        WHERE user_id = ${userId} AND meta_key IN ('first_name', 'last_name', 'doctor_description')
      `);

      const metaMap: Record<string, string> = {};
      metaResult.forEach(r => { metaMap[r.meta_key] = r.meta_value; });

      result.push({
        doctorId: String(m.doctor_id),
        clinicId: String(m.clinic_id),
        clinicName: m.clinicName || '',
        clinicEmail: m.clinicEmail || '',
        displayName: m.displayName || `${metaMap['first_name'] || ''} ${metaMap['last_name'] || ''}`.trim() || 'Professional',
        firstName: metaMap['first_name'] || '',
        lastName: metaMap['last_name'] || '',
        specialties: m.specialties ? JSON.parse(m.specialties) : [],
        description: metaMap['doctor_description'] || null,
      });
    }

    return result;
  } catch (err) {
    console.error('Error fetching WordPress professionals:', err);
    return [];
  }
}

// Fetch services from WordPress KiviCare tables
async function getWordPressServices(): Promise<KiviCareService[]> {
  try {
    // Get distinct services with their info (no GROUP BY needed)
    const services = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        s.id,
        s.name,
        s.type,
        s.category,
        s.price,
        sdm.charges,
        sdm.duration,
        sdm.telemed_service,
        sdm.service_name_alias,
        c.id as clinic_id,
        c.name as clinicName
      FROM wp_kc_service_doctor_mapping sdm
      JOIN wp_kc_services s ON sdm.service_id = s.id
      JOIN wp_kc_clinics c ON sdm.clinic_id = c.id
      WHERE sdm.status = 1 AND s.status = 1 AND c.status = 1
      ORDER BY s.name
      LIMIT 8
    `);

    // Deduplicate by service id
    const seen = new Set<number>();
    const uniqueServices = services.filter(s => {
      const id = Number(s.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    return uniqueServices.map((s: any) => ({
      id: String(s.id),
      name: s.service_name_alias || s.name,
      type: s.type,
      category: s.category,
      price: parseFloat(s.charges || s.price || '0'),
      duration: s.duration || 60,
      telemedService: s.telemed_service === 'yes',
      clinicId: String(s.clinic_id),
      clinicName: s.clinicName,
    }));
  } catch (err) {
    console.error('Error fetching WordPress services:', err);
    return [];
  }
}

const PROFESSIONALS_STATIC = [
  { name: 'Dr. Ratna, M.Psi', type: 'Psikolog Klinis', spec: 'Anxiety, Trauma, OCD', exp: '12 tahun' },
  { name: 'Dr. Budi, Sp.KJ', type: 'Psikiater', spec: 'Depresi, Bipolar, Skizofrenia', exp: '15 tahun' },
  { name: 'Sari, M.Psi', type: 'Psikolog Anak', spec: 'Autisme, ADHD, Kesulitan Belajar', exp: '8 tahun' },
  { name: 'Andi, M.Psi', type: 'Konselor', spec: 'Relationship, Karir, Keluarga', exp: '6 tahun' },
  { name: 'Dr. Linda, M.Psi', type: 'Psikolog Klinis', spec: 'Eating Disorder, Body Image', exp: '10 tahun' },
  { name: 'Rina, M.Psi', type: 'Psikolog Anak', spec: 'Remaja, Bullying, Identitas', exp: '7 tahun' },
];

const SERVICES_STATIC = [
  { icon: '💬', title: 'Konseling Individual', desc: 'Sesi 1-on-1 dengan psikolog berpengalaman', duration: '60 menit' },
  { icon: '👥', title: 'Konseling Keluarga', desc: 'Sesi bersama untuk keharmonisan keluarga', duration: '90 menit' },
  { icon: '🧪', title: 'Asesmen Psikologis', desc: 'Tes psikologi komprehensif dengan laporan', duration: '120 menit' },
  { icon: '💑', title: 'Konseling Pasangan', desc: 'Sesi khusus untuk permasalahan relationship', duration: '90 menit' },
  { icon: '👶', title: 'Psikologi Anak', desc: 'Sesi khusus anak dengan pendekatan bermain', duration: '60 menit' },
  { icon: '🏢', title: 'Konsultasi Korporat', desc: 'Layanan untuk perusahaan dan tim', duration: 'Fleksibel' },
  { icon: '🌐', title: 'Telekonsultasi', desc: 'Sesi online via video call', duration: '60 menit' },
  { icon: '📋', title: 'Konsultasi Awal', desc: 'Diskusi awal 30 menit gratis', duration: '30 menit' },
];

const FAQ_STATIC = [
  { q: 'Apakah saya perlu membuat akun untuk booking?', a: 'Tidak wajib. Anda bisa booking sebagai tamu dan membuat akun nanti, atau langsung daftar untuk pengalaman lebih cepat.' },
  { q: 'Bagaimana cara pembayaran?', a: 'Pembayaran dilakukan di klinik sebelum sesi. Kami menerima tunai, kartu, dan QRIS.' },
  { q: 'Apakah bisa membatalkan atau reschedule?', a: 'Ya, pembatalan gratis hingga H-24. Reschedule dapat dilakukan maksimal 2x.' },
  { q: 'Apakah sesi saya rahasia?', a: 'Sangat rahasia. Semua catatan klien hanya dapat diakses oleh profesional yang menangani Anda.' },
  { q: 'Berapa durasi standar satu sesi?', a: '60 menit konseling, 90 menit keluarga/pasangan, 120 menit asesmen.' },
];

const TESTIMONIALS_STATIC = [
  { name: 'Maya S.', text: 'Proses booking-nya simpel banget. Sesi pertama langsung dapat gambaran jelas tentang kondisi saya.' },
  { name: 'Hendra K.', text: 'Dr. Budi sangat profesional. Saya merasa didengar dan dapat penanganan yang tepat.' },
  { name: 'Linda W.', text: 'Telekonsultasi-nya sangat membantu. Tidak perlu ke klinik, bisa dari rumah.' },
];

// Service type to icon mapping
const SERVICE_TYPE_ICONS: Record<string, string> = {
  konseling: '💬',
  asesmen: '🧪',
  psikoterapi: '🔮',
  terapi: '💆',
  test_cbt: '🧠',
  general_dentistry: '🦷',
  system_service: '🌐',
};

export default async function LandingPage() {
  const [wpProfessionals, wpServices] = await Promise.all([
    getWordPressProfessionals(),
    getWordPressServices(),
  ]);

  // Use WordPress data if available, fallback to static
  const proList = wpProfessionals.length > 0 ? wpProfessionals : PROFESSIONALS_STATIC.map((p, idx) => ({
    id: String(idx),
    displayName: p.name,
    type: p.type,
    specialties: [p.spec],
    description: null,
    clinicName: '',
    doctorId: '0',
    clinicId: '0',
    clinicEmail: '',
    firstName: '',
    lastName: '',
  }));

  const svcList = wpServices.length > 0 ? wpServices : SERVICES_STATIC.map((s, idx) => ({
    ...s,
    id: s.title || String(idx),
    serviceNameAlias: s.title,
    type: 'default',
    category: s.desc,
    price: 0,
    duration: 60,
    telemedService: false,
    clinicId: '0',
    clinicName: '',
  }));

  return (
    <>
      {/* NAV */}
      <header className="sticky top-0 z-40 border-b border-surface-container-high bg-white/80 backdrop-blur">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 text-xl font-bold text-primary-700">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary-700 text-white">P</span>
            PraktiQU
          </Link>
          <div className="hidden items-center gap-6 md:flex">
            <Link href="#profesional" className="text-sm font-medium text-on-surface-variant hover:text-primary-700">Pilih Profesional</Link>
            <Link href="#layanan" className="text-sm font-medium text-on-surface-variant hover:text-primary-700">Pilih Layanan</Link>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn-ghost">Masuk / Daftar</Link>
            <Link href="/book" className="btn-primary">Booking Sekarang</Link>
          </div>
        </nav>
      </header>

      <main className="py-12 space-y-16">
        {/* PROFESIONAL */}
        <section id="profesional">
          <div className="mx-auto max-w-7xl px-6">
            <div className="flex items-end justify-between mb-8">
              <div>
                <h1 className="text-3xl font-bold text-on-surface md:text-4xl">Temukan Profesional Anda</h1>
                <p className="mt-2 text-on-surface-variant">Pilih psikolog atau psikiater terbaik untuk perjalanan kesehatan mental Anda.</p>
              </div>
              <Link href="/book" className="hidden text-sm font-semibold text-primary-700 hover:underline md:block">Lihat Semua Jadwal →</Link>
            </div>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {proList.map((p, idx) => {
                // Handle both WordPress and static data formats
                const displayName = 'displayName' in p ? p.displayName : ('name' in p ? p.name : 'Professional');
                const type = 'type' in p ? p.type : ('spec' in p ? p.spec : '');
                const specialties = 'specialties' in p ? p.specialties as string[] : ('spec' in p ? [p.spec] : []);
                const clinicName = 'clinicName' in p ? p.clinicName : '';
                const description = 'description' in p ? p.description : null;

                return (
                  <div key={p.id || idx} className="card">
                    <div className="flex items-center gap-4">
                      <div className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-primary-700 to-primary-600 text-lg font-semibold text-white">
                        {displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-on-surface">{displayName}</div>
                        <div className="text-xs text-on-surface-variant">{type || clinicName}</div>
                      </div>
                    </div>
                    {specialties.length > 0 && (
                      <div className="mt-4 space-y-2 text-sm">
                        <div><span className="text-outline">Spesialisasi:</span>{' '}<span className="text-on-surface">{specialties.slice(0, 2).map((s: any) => typeof s === 'object' ? s.label : s).join(', ')}</span></div>
                      </div>
                    )}
                    {description && (
                      <p className="mt-2 text-xs text-on-surface-variant line-clamp-2">{description}</p>
                    )}
                    <Link href="/book" className="btn-secondary mt-4 w-full">Lihat Jadwal</Link>
                  </div>
                );
              })}
            </div>
            <div className="mt-6 text-center md:hidden">
              <Link href="/book" className="text-sm font-semibold text-primary-700 hover:underline">Lihat Semua Jadwal →</Link>
            </div>
          </div>
        </section>

        {/* LAYANAN */}
        <section id="layanan" className="bg-surface py-16">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mb-8">
              <h2 className="text-3xl font-bold text-on-surface md:text-4xl">Layanan Yang Tersedia</h2>
              <p className="mt-2 text-on-surface-variant">Berbagai pilihan layanan sesuai kebutuhan Anda.</p>
            </div>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {svcList.map((s, idx) => {
                // Handle both WordPress and static data formats
                const title = 'title' in s ? s.title : ('name' in s ? s.name : 'Layanan');
                const desc = 'desc' in s ? s.desc : ('category' in s ? s.category : '');
                const duration = 'duration' in s ? s.duration : ('telemedService' in s && s.telemedService ? '60 menit' : '60 menit');
                const icon = 'icon' in s ? s.icon : (SERVICE_TYPE_ICONS[(s as any).type] || '✨');
                const price = 'price' in s ? s.price : 0;
                const serviceId = 'id' in s ? s.id : idx.toString();

                return (
                  <div key={serviceId} className="card group transition-shadow hover:shadow-md">
                    <div className="text-3xl">{icon}</div>
                    <h3 className="mt-3 text-base font-semibold text-on-surface">{title}</h3>
                    <p className="mt-1 text-sm text-on-surface-variant">{desc}</p>
                    <div className="mt-4 flex items-center justify-between text-xs">
                      <span className="text-outline">⏱ {typeof duration === 'number' ? `${duration} menit` : duration}</span>
                      {typeof price === 'number' && price > 0 && (
                        <span className="font-semibold text-primary-700">
                          {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(price)}
                        </span>
                      )}
                    </div>
                    <Link href="/book" className="mt-3 block text-center text-sm font-semibold text-primary-700 group-hover:underline">Booking →</Link>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-surface-container-high bg-white py-12">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 md:grid-cols-4">
          <div>
            <Link href="/" className="flex items-center gap-2 text-lg font-bold text-primary-700">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary-700 text-white">P</span>
              PraktiQU
            </Link>
            <p className="mt-3 text-sm text-on-surface-variant">Platform manajemen klinik psikologi modern.</p>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-on-surface">Layanan</h4>
            <ul className="mt-3 space-y-2 text-sm text-on-surface-variant">
              <li><Link href="/book">Booking Online</Link></li>
              <li><Link href="/book">Telekonsultasi</Link></li>
              <li><Link href="/book">Asesmen</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-on-surface">Tentang</h4>
            <ul className="mt-3 space-y-2 text-sm text-on-surface-variant">
              <li><Link href="#">Tentang Kami</Link></li>
              <li><Link href="#profesional">Tim Profesional</Link></li>
              <li><Link href="#">Karir</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-on-surface">Kontak</h4>
            <ul className="mt-3 space-y-2 text-sm text-on-surface-variant">
              <li>📧 hello@praktiqu.id</li>
              <li>📞 (021) 1234-5678</li>
              <li>📍 Jakarta, Indonesia</li>
            </ul>
          </div>
        </div>
        <div className="mx-auto mt-12 max-w-7xl border-t border-surface-container-high px-6 pt-6 text-center text-xs text-outline">
          © 2026 PraktiQU. Semua hak dilindungi.
        </div>
      </footer>
    </>
  );
}