// src/app/page.tsx
// PraktiQU public landing page.
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { BookingWizardSteps } from '@/components/booking/wizard-step-indicator';

export const dynamic = 'force-dynamic';

async function getLandingData() {
  try {
    const [professionals, services] = await Promise.all([
      prisma.professional
        .findMany({
          where: { status: 'ACTIVE' as any },
          take: 6,
          orderBy: { createdAt: 'desc' },
          include: { user: true },
        })
        .catch(() => []),
      prisma.service
        .findMany({
          where: { status: 1 },
          take: 8,
          orderBy: { name: 'asc' },
        })
        .catch(() => []),
    ]);
    return { professionals, services };
  } catch {
    return { professionals: [], services: [] };
  }
}

export default async function LandingPage() {
  const { professionals, services } = await getLandingData();

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-[#e4e1ee] bg-white/80 backdrop-blur">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 text-xl font-bold text-[#3625cd]">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#3625cd] text-white">P</span>
            PraktiQU
          </Link>
          <div className="hidden gap-6 md:flex">
            <Link href="#layanan" className="text-sm font-medium text-[#464555] hover:text-[#3625cd]">
              Layanan
            </Link>
            <Link href="#profesional" className="text-sm font-medium text-[#464555] hover:text-[#3625cd]">
              Profesional
            </Link>
            <Link href="#alur" className="text-sm font-medium text-[#464555] hover:text-[#3625cd]">
              Cara Booking
            </Link>
            <Link href="#faq" className="text-sm font-medium text-[#464555] hover:text-[#3625cd]">
              FAQ
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn-ghost">
              Masuk
            </Link>
            <Link href="/book" className="btn-primary">
              Booking Sekarang
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* HERO */}
        <section className="relative overflow-hidden bg-gradient-to-br from-[#f6f2ff] via-[#fcf8ff] to-white">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-20 lg:grid-cols-2">
            <div>
              <span className="chip mb-4">🧠 Klinik Psikologi Modern</span>
              <h1 className="text-4xl font-bold leading-tight tracking-tight text-[#1b1b24] md:text-5xl">
                Booking Sesi dengan
                <br />
                <span className="text-[#3625cd]">Profesional Tepercaya</span>
              </h1>
              <p className="mt-6 text-lg text-[#464555]">
                PraktiQU memudahkan Anda menemukan psikolog, psikiater, dan konselor
                berpengalaman. Pilih jadwal, lakukan booking, dan mulai perjalanan
                kesehatan mental Anda hari ini.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/book" className="btn-primary">
                  Mulai Booking
                </Link>
                <Link href="#layanan" className="btn-secondary">
                  Lihat Layanan
                </Link>
              </div>
              <div className="mt-10 grid grid-cols-3 gap-6 border-t border-[#e4e1ee] pt-6">
                <div>
                  <div className="text-2xl font-bold text-[#3625cd]">50+</div>
                  <div className="text-xs text-[#464555]">Profesional Aktif</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-[#3625cd]">1.2K+</div>
                  <div className="text-xs text-[#464555]">Klien Puas</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-[#3625cd]">4.9★</div>
                  <div className="text-xs text-[#464555]">Rating Rata-rata</div>
                </div>
              </div>
            </div>
            <div className="relative">
              <div className="card space-y-4 p-8">
                <div className="flex items-center gap-3 border-b border-[#e4e1ee] pb-4">
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-[#3625cd] text-lg font-semibold text-white">
                    DR
                  </div>
                  <div>
                    <div className="font-semibold text-[#1b1b24]">Dr. Ratna, M.Psi</div>
                    <div className="text-xs text-[#464555]">Psikolog Klinis • 12 thn pengalaman</div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#464555]">Slot Tersedia Hari Ini</div>
                  <div className="grid grid-cols-3 gap-2">
                    {['09:00', '10:30', '13:00', '14:30', '16:00', '19:00'].map((time) => (
                      <div
                        key={time}
                        className="rounded-lg border border-[#c7c4d8] px-3 py-2 text-center text-sm font-medium text-[#1b1b24]"
                      >
                        {time}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg bg-[#f6f2ff] p-3 text-xs text-[#3625cd]">
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
              <h2 className="text-3xl font-bold text-[#1b1b24] md:text-4xl">
                Pilih Layanan yang Anda Butuhkan
              </h2>
              <p className="mt-3 text-[#464555]">
                Dari konseling individu hingga asesmen psikologis komprehensif
              </p>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: '💬', title: 'Konseling Individual', desc: 'Sesi 1-on-1 dengan psikolog berpengalaman', duration: '60 menit' },
                { icon: '👥', title: 'Konseling Keluarga', desc: 'Sesi bersama untuk keharmonisan keluarga', duration: '90 menit' },
                { icon: '🧪', title: 'Asesmen Psikologis', desc: 'Tes psikologi komprehensif dengan laporan', duration: '120 menit' },
                { icon: '💑', title: 'Konseling Pasangan', desc: 'Sesi khusus untuk permasalahan relationship', duration: '90 menit' },
                { icon: '👶', title: 'Psikologi Anak', desc: 'Sesi khusus anak dengan pendekatan bermain', duration: '60 menit' },
                { icon: '🏢', title: 'Konsultasi Korporat', desc: 'Layanan untuk perusahaan dan tim', duration: 'Fleksibel' },
                { icon: '🌐', title: 'Telekonsultasi', desc: 'Sesi online via video call', duration: '60 menit' },
                { icon: '📋', title: 'Konsultasi Awal', desc: 'Diskusi awal 30 menit gratis', duration: '30 menit' },
              ].map((s) => (
                <div key={s.title} className="card group transition-shadow hover:shadow-md">
                  <div className="text-3xl">{s.icon}</div>
                  <h3 className="mt-3 text-base font-semibold text-[#1b1b24]">{s.title}</h3>
                  <p className="mt-1 text-sm text-[#464555]">{s.desc}</p>
                  <div className="mt-4 flex items-center justify-between text-xs">
                    <span className="text-[#777587]">⏱ {s.duration}</span>
                    <Link href="/book" className="font-semibold text-[#3625cd] group-hover:underline">
                      Booking →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* PROFESIONAL */}
        <section id="profesional" className="bg-[#f6f2ff] py-20">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <span className="chip mb-3">Tim Profesional</span>
              <h2 className="text-3xl font-bold text-[#1b1b24] md:text-4xl">
                Psikolog & Psikiater Bersertifikat
              </h2>
              <p className="mt-3 text-[#464555]">
                Tim klinis kami memiliki lisensi HIMPSI dan pengalaman minimal 5 tahun
              </p>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {[
                { name: 'Dr. Ratna, M.Psi', type: 'Psikolog Klinis', spec: 'Anxiety, Trauma, OCD', exp: '12 tahun' },
                { name: 'Dr. Budi, Sp.KJ', type: 'Psikiater', spec: 'Depresi, Bipolar, Skizofrenia', exp: '15 tahun' },
                { name: 'Sari, M.Psi', type: 'Psikolog Anak', spec: 'Autisme, ADHD, Kesulitan Belajar', exp: '8 tahun' },
                { name: 'Andi, M.Psi', type: 'Konselor', spec: 'Relationship, Karir, Keluarga', exp: '6 tahun' },
                { name: 'Dr. Linda, M.Psi', type: 'Psikolog Klinis', spec: 'Eating Disorder, Body Image', exp: '10 tahun' },
                { name: 'Rina, M.Psi', type: 'Psikolog Anak', spec: 'Remaja, Bullying, Identitas', exp: '7 tahun' },
              ].map((p) => (
                <div key={p.name} className="card">
                  <div className="flex items-center gap-4">
                    <div className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-[#3625cd] to-[#5046e5] text-lg font-semibold text-white">
                      {p.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-[#1b1b24]">{p.name}</div>
                      <div className="text-xs text-[#464555]">{p.type}</div>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2 text-sm">
                    <div>
                      <span className="text-[#777587]">Spesialisasi:</span>{' '}
                      <span className="text-[#1b1b24]">{p.spec}</span>
                    </div>
                    <div>
                      <span className="text-[#777587]">Pengalaman:</span>{' '}
                      <span className="text-[#1b1b24]">{p.exp}</span>
                    </div>
                  </div>
                  <Link href="/book" className="btn-secondary mt-4 w-full">
                    Lihat Jadwal
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ALUR BOOKING */}
        <section id="alur" className="bg-white py-20">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <span className="chip mb-3">Cara Booking</span>
              <h2 className="text-3xl font-bold text-[#1b1b24] md:text-4xl">
                5 Langkah Mudah Booking Sesi
              </h2>
            </div>
            <div className="mt-12">
              <BookingWizardSteps currentStep={1} />
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-5">
              {[
                { n: 1, t: 'Pilih Profesional', d: 'Lihat profil dan spesialisasi psikolog/psikiater kami' },
                { n: 2, t: 'Pilih Layanan', d: 'Konseling, asesmen, atau telekonsultasi' },
                { n: 3, t: 'Pilih Jadwal', d: 'Pilih tanggal dan waktu yang tersedia' },
                { n: 4, t: 'Data Diri', d: 'Login jika sudah punya akun, atau daftar baru' },
                { n: 5, t: 'Konfirmasi', d: 'Terima konfirmasi dan detail sesi via email' },
              ].map((s) => (
                <div key={s.n} className="text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#3625cd] text-lg font-semibold text-white">
                    {s.n}
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-[#1b1b24]">{s.t}</h3>
                  <p className="mt-1 text-xs text-[#464555]">{s.d}</p>
                </div>
              ))}
            </div>
            <div className="mt-12 text-center">
              <Link href="/book" className="btn-primary px-8 py-3 text-base">
                Mulai Sekarang →
              </Link>
            </div>
          </div>
        </section>

        {/* TESTIMONI */}
        <section className="bg-[#fcf8ff] py-20">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <span className="chip mb-3">Testimoni</span>
              <h2 className="text-3xl font-bold text-[#1b1b24] md:text-4xl">
                Apa Kata Klien Kami
              </h2>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {[
                { name: 'Maya S.', text: 'Proses booking-nya simpel banget. Sesi pertama langsung dapat gambaran jelas tentang kondisi saya.' },
                { name: 'Hendra K.', text: 'Dr. Budi sangat profesional. Saya merasa didengar dan dapat penanganan yang tepat.' },
                { name: 'Linda W.', text: 'Telekonsultasi-nya sangat membantu. Tidak perlu ke klinik, bisa dari rumah.' },
              ].map((t) => (
                <div key={t.name} className="card">
                  <div className="flex gap-1 text-[#3625cd]">★★★★★</div>
                  <p className="mt-3 text-sm text-[#1b1b24]">"{t.text}"</p>
                  <div className="mt-4 text-sm font-semibold text-[#464555]">— {t.name}</div>
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
              <h2 className="text-3xl font-bold text-[#1b1b24] md:text-4xl">
                Pertanyaan yang Sering Diajukan
              </h2>
            </div>
            <div className="mt-12 space-y-3">
              {[
                { q: 'Apakah saya perlu membuat akun untuk booking?', a: 'Tidak wajib. Anda bisa booking sebagai tamu dan membuat akun nanti, atau langsung daftar untuk pengalaman lebih cepat.' },
                { q: 'Bagaimana cara pembayaran?', a: 'Pembayaran dilakukan di klinik sebelum sesi dimulai. Kami menerima tunai, kartu, dan QRIS.' },
                { q: 'Apakah bisa membatalkan atau reschedule?', a: 'Ya, pembatalan gratis hingga H-24. Reschedule dapat dilakukan maksimal 2x.' },
                { q: 'Apakah sesi saya rahasia?', a: 'Sangat rahasia. Semua catatan klien hanya dapat diakses oleh profesional yang menangani Anda.' },
                { q: 'Berapa durasi standar satu sesi?', a: '60 menit untuk konseling, 90 menit untuk konseling keluarga/pasangan, 120 menit untuk asesmen.' },
              ].map((f, i) => (
                <details key={i} className="card cursor-pointer">
                  <summary className="flex items-center justify-between font-semibold text-[#1b1b24]">
                    {f.q}
                    <span className="text-[#3625cd]">+</span>
                  </summary>
                  <p className="mt-3 text-sm text-[#464555]">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-[#3625cd] py-16">
          <div className="mx-auto max-w-3xl px-6 text-center text-white">
            <h2 className="text-3xl font-bold md:text-4xl">
              Siap Memulai Perjalanan Anda?
            </h2>
            <p className="mt-3 text-lg text-[#dbd8ff]">
              Booking sesi pertama Anda hari ini. Konsultasi awal gratis 30 menit.
            </p>
            <Link
              href="/book"
              className="mt-8 inline-flex items-center justify-center rounded-lg bg-white px-8 py-3 text-base font-semibold text-[#3625cd] transition-colors hover:bg-[#f6f2ff]"
            >
              Booking Sesi Pertama →
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#e4e1ee] bg-white py-12">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 md:grid-cols-4">
          <div>
            <Link href="/" className="flex items-center gap-2 text-lg font-bold text-[#3625cd]">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#3625cd] text-white">P</span>
              PraktiQU
            </Link>
            <p className="mt-3 text-sm text-[#464555]">
              Platform manajemen klinik psikologi modern.
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[#1b1b24]">Layanan</h4>
            <ul className="mt-3 space-y-2 text-sm text-[#464555]">
              <li><Link href="/book">Booking Online</Link></li>
              <li><Link href="/book">Telekonsultasi</Link></li>
              <li><Link href="/book">Asesmen</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[#1b1b24]">Tentang</h4>
            <ul className="mt-3 space-y-2 text-sm text-[#464555]">
              <li><Link href="#">Tentang Kami</Link></li>
              <li><Link href="#">Tim Profesional</Link></li>
              <li><Link href="#">Karir</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[#1b1b24]">Kontak</h4>
            <ul className="mt-3 space-y-2 text-sm text-[#464555]">
              <li>📧 hello@praktiqu.id</li>
              <li>📞 (021) 1234-5678</li>
              <li>📍 Jakarta, Indonesia</li>
            </ul>
          </div>
        </div>
        <div className="mx-auto mt-12 max-w-7xl border-t border-[#e4e1ee] px-6 pt-6 text-center text-xs text-[#777587]">
          © 2026 PraktiQU. Semua hak dilindungi.
        </div>
      </footer>
    </>
  );
}