// src/app/page.tsx
// PraktiQU public landing page.
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { BookingWizardSteps } from '@/components/booking/wizard-step-indicator';

export const dynamic = 'force-dynamic';

async function getLandingData() {
  try {
    const [professionals, services] = await Promise.all([
      prisma.professional.findMany({
        where: { status: 'ACTIVE' as any },
        take: 6,
        orderBy: { createdAt: 'desc' },
        include: { user: true },
      }).catch(() => []),
      prisma.service.findMany({
        where: { status: 1 },
        take: 8,
        orderBy: { name: 'asc' },
      }).catch(() => []),
    ]);
    return { professionals, services };
  } catch {
    return { professionals: [] as typeof [], services: [] as typeof [] };
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

export default async function LandingPage() {
  const { professionals, services } = await getLandingData();
  const proList = professionals.length > 0 ? professionals : PROFESSIONALS_STATIC.map((p) => ({ ...p, id: p.name }));
  const svcList = services.length > 0 ? services : SERVICES_STATIC.map((s) => ({ ...s, id: s.title }));

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
            <Link href="#layanan" className="text-sm font-medium text-on-surface-variant hover:text-primary-700">Layanan</Link>
            <Link href="#profesional" className="text-sm font-medium text-on-surface-variant hover:text-primary-700">Profesional</Link>
            <Link href="#alur" className="text-sm font-medium text-on-surface-variant hover:text-primary-700">Cara Booking</Link>
            <Link href="#faq" className="text-sm font-medium text-on-surface-variant hover:text-primary-700">FAQ</Link>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn-ghost">Masuk</Link>
            <Link href="/book" className="btn-primary">Booking Sekarang</Link>
          </div>
        </nav>
      </header>

      <main>
        {/* HERO */}
        <section className="relative overflow-hidden bg-gradient-to-br from-primary-50 via-surface to-white py-20">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 lg:grid-cols-2">
            <div>
              <span className="chip mb-4">🧠 Klinik Psikologi Modern</span>
              <h1 className="text-4xl font-bold tracking-tight text-on-surface md:text-5xl">
                Booking Sesi dengan{' '}
                <span className="text-primary-700">Profesional Tepercaya</span>
              </h1>
              <p className="mt-6 text-lg text-on-surface-variant">
                PraktiQU memudahkan Anda menemukan psikolog, psikiater, dan konselor berpengalaman.
                Pilih jadwal, lakukan booking, dan mulai perjalanan kesehatan mental Anda hari ini.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/book" className="btn-primary px-8 py-3">Mulai Booking</Link>
                <Link href="#layanan" className="btn-secondary px-8 py-3">Lihat Layanan</Link>
              </div>
              <div className="mt-10 grid grid-cols-3 gap-6 border-t border-surface-container-high pt-6">
                <div><div className="text-2xl font-bold text-primary-700">50+</div><div className="text-xs text-on-surface-variant">Profesional Aktif</div></div>
                <div><div className="text-2xl font-bold text-primary-700">1.2K+</div><div className="text-xs text-on-surface-variant">Klien Puas</div></div>
                <div><div className="text-2xl font-bold text-primary-700">4.9★</div><div className="text-xs text-on-surface-variant">Rating Rata-rata</div></div>
              </div>
            </div>
            <div>
              <div className="card space-y-4 p-8">
                <div className="flex items-center gap-3 border-b border-surface-container-high pb-4">
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-primary-700 text-lg font-semibold text-white">DR</div>
                  <div>
                    <div className="font-semibold text-on-surface">Dr. Ratna, M.Psi</div>
                    <div className="text-xs text-on-surface-variant">Psikolog Klinis • 12 thn pengalaman</div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Slot Tersedia Hari Ini</div>
                  <div className="grid grid-cols-3 gap-2">
                    {['09:00', '10:30', '13:00', '14:30', '16:00', '19:00'].map((t) => (
                      <div key={t} className="rounded-lg border border-outline-variant px-3 py-2 text-center text-sm font-medium text-on-surface">
                        {t}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg bg-surface-container-low p-3 text-xs text-primary-700">
                  ✓ Booking terverifikasi • Pembatalan gratis H-24
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* LAYANAN */}
        <section id="layanan" className="bg-white py-20">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <span className="chip mb-3">Layanan</span>
              <h2 className="text-3xl font-bold text-on-surface md:text-4xl">Pilih Layanan yang Anda Butuhkan</h2>
              <p className="mt-3 text-on-surface-variant">Dari konseling individu hingga asesmen psikologis komprehensif</p>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {(svcList as typeof SERVICES_STATIC).map((s) => (
                <div key={s.id} className="card group transition-shadow hover:shadow-md">
                  <div className="text-3xl">{s.icon}</div>
                  <h3 className="mt-3 text-base font-semibold text-on-surface">{s.title}</h3>
                  <p className="mt-1 text-sm text-on-surface-variant">{s.desc}</p>
                  <div className="mt-4 flex items-center justify-between text-xs">
                    <span className="text-outline">⏱ {s.duration}</span>
                    <Link href="/book" className="font-semibold text-primary-700 group-hover:underline">Booking →</Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* PROFESIONAL */}
        <section id="profesional" className="bg-surface py-20">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <span className="chip mb-3">Tim Profesional</span>
              <h2 className="text-3xl font-bold text-on-surface md:text-4xl">Psikolog & Psikiater Bersertifikat</h2>
              <p className="mt-3 text-on-surface-variant">Tim klinis kami memiliki lisensi HIMPSI dan pengalaman minimal 5 tahun</p>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {PROFESSIONALS_STATIC.map((p) => (
                <div key={p.name} className="card">
                  <div className="flex items-center gap-4">
                    <div className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-primary-700 to-primary-600 text-lg font-semibold text-white">
                      {p.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-on-surface">{p.name}</div>
                      <div className="text-xs text-on-surface-variant">{p.type}</div>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2 text-sm">
                    <div><span className="text-outline">Spesialisasi:</span>{' '}<span className="text-on-surface">{p.spec}</span></div>
                    <div><span className="text-outline">Pengalaman:</span>{' '}<span className="text-on-surface">{p.exp}</span></div>
                  </div>
                  <Link href="/book" className="btn-secondary mt-4 w-full">Lihat Jadwal</Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ALUR */}
        <section id="alur" className="bg-white py-20">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <span className="chip mb-3">Cara Booking</span>
              <h2 className="text-3xl font-bold text-on-surface md:text-4xl">5 Langkah Mudah Booking Sesi</h2>
            </div>
            <div className="mt-12">
              <BookingWizardSteps currentStep={1} />
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-5">
              {[
                { n: 1, t: 'Pilih Profesional', d: 'Lihat profil dan spesialisasi' },
                { n: 2, t: 'Pilih Layanan', d: 'Konseling, asesmen, atau telekonsultasi' },
                { n: 3, t: 'Pilih Jadwal', d: 'Pilih tanggal dan waktu yang tersedia' },
                { n: 4, t: 'Data Diri', d: 'Login jika punya akun, atau daftar baru' },
                { n: 5, t: 'Konfirmasi', d: 'Terima konfirmasi dan detail via email' },
              ].map((s) => (
                <div key={s.n} className="text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary-700 text-lg font-semibold text-white">{s.n}</div>
                  <h3 className="mt-3 text-sm font-semibold text-on-surface">{s.t}</h3>
                  <p className="mt-1 text-xs text-on-surface-variant">{s.d}</p>
                </div>
              ))}
            </div>
            <div className="mt-12 text-center">
              <Link href="/book" className="btn-primary px-8 py-3 text-base">Mulai Sekarang →</Link>
            </div>
          </div>
        </section>

        {/* TESTIMONI */}
        <section className="bg-surface py-20">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <span className="chip mb-3">Testimoni</span>
              <h2 className="text-3xl font-bold text-on-surface md:text-4xl">Apa Kata Klien Kami</h2>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {TESTIMONIALS_STATIC.map((t) => (
                <div key={t.name} className="card">
                  <div className="flex gap-1 text-primary-700">★★★★★</div>
                  <p className="mt-3 text-sm text-on-surface">"{t.text}"</p>
                  <div className="mt-4 text-sm font-semibold text-on-surface-variant">— {t.name}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="bg-white py-20">
          <div className="mx-auto max-w-3xl px-6">
            <div className="text-center">
              <span className="chip mb-3">FAQ</span>
              <h2 className="text-3xl font-bold text-on-surface md:text-4xl">Pertanyaan yang Sering Diajukan</h2>
            </div>
            <div className="mt-12 space-y-3">
              {FAQ_STATIC.map((f, i) => (
                <details key={i} className="card cursor-pointer">
                  <summary className="flex items-center justify-between font-semibold text-on-surface">
                    {f.q}
                    <span className="text-primary-700">+</span>
                  </summary>
                  <p className="mt-3 text-sm text-on-surface-variant">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-primary-700 py-16">
          <div className="mx-auto max-w-3xl px-6 text-center text-white">
            <h2 className="text-3xl font-bold md:text-4xl">Siap Memulai Perjalanan Anda?</h2>
            <p className="mt-3 text-lg text-primary-200">Booking sesi pertama Anda hari ini. Konsultasi awal gratis 30 menit.</p>
            <Link href="/book" className="mt-8 inline-flex items-center justify-center rounded-lg bg-white px-8 py-3 text-base font-semibold text-primary-700 transition-colors hover:bg-primary-50">
              Booking Sesi Pertama →
            </Link>
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
