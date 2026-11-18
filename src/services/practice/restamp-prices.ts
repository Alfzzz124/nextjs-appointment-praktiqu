/**
 * Stempel ulang cermin rupiah satu klinik setelah kursnya berubah.
 *
 * `charges` bukan sumber kebenaran untuk alur kami — order selalu menurunkan rupiahnya
 * ulang dari `praktiqu_price_usd` pada kurs saat itu. Yang dilayani fungsi ini adalah
 * layar KiviCare sendiri, yang membaca `charges` apa adanya.
 *
 * Satu pernyataan `UPDATE ... CASE` per 200 baris, bukan satu UPDATE per baris: klinik
 * dengan ratusan layanan akan menghabiskan `max_user_connections` yang hanya 5 di sana.
 *
 * Sengaja BUKAN job Action Scheduler: hook baru menuntut allow-list, `add_action`, dan
 * handler webhook di plugin (class-praktiqu-endpoint-jobs.php:92) — perubahan plugin demi
 * pekerjaan yang murni kosmetik.
 *
 * Spec: docs/superpowers/specs/2026-11-18-harga-layanan-dolar-design.md §1
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ANY_USD_PRICE_PROBE, idrFromUsd, readUsdPrice } from '@/repositories/wp/usd-price-marker';

/** Sebanyak ini baris per pernyataan UPDATE. */
export const RESTAMP_BATCH = 200;

export interface RestampResult {
  /** Baris yang rupiahnya ditulis ulang. */
  updated: number;
  /** Berapa pernyataan UPDATE yang benar-benar dikirim. */
  statements: number;
}

/**
 * Tulis ulang `charges` setiap layanan ber-harga-dolar milik satu klinik.
 *
 * Melempar kalau basis datanya menolak. Pemanggil yang menyimpan setelan menangkapnya dan
 * mencatatnya sebagai peringatan: harga dolarnya sudah tersimpan benar, dan menggagalkan
 * penyimpanan yang sudah berhasil hanya karena cerminnya tertinggal lebih buruk.
 */
export async function restampClinicPrices(clinicId: number, rate: Prisma.Decimal): Promise<RestampResult> {
  const rows = await prisma.kcServiceDoctorMapping.findMany({
    where: { clinicId: BigInt(clinicId), ...ANY_USD_PRICE_PROBE },
    select: { id: true, extra: true },
  });

  // `ANY_USD_PRICE_PROBE` hanya mencocokkan teks, jadi hasilnya kandidat: `readUsdPrice`
  // yang memutuskan, sama seperti pada penanda opsi durasi.
  const pairs: Array<{ id: bigint; charges: string }> = [];
  for (const r of rows) {
    const usd = readUsdPrice(r.extra);
    if (usd === null) continue;
    pairs.push({ id: r.id, charges: String(idrFromUsd(usd, rate)) });
  }

  let statements = 0;
  for (let i = 0; i < pairs.length; i += RESTAMP_BATCH) {
    const chunk = pairs.slice(i, i + RESTAMP_BATCH);
    const cases = chunk.map(() => 'WHEN ? THEN ?').join(' ');
    const ids = chunk.map(() => '?').join(', ');
    await prisma.$executeRawUnsafe(
      `UPDATE wp_kc_service_doctor_mapping SET charges = CASE id ${cases} END WHERE id IN (${ids})`,
      ...chunk.flatMap((c) => [c.id, c.charges]),
      ...chunk.map((c) => c.id),
    );
    statements += 1;
  }

  return { updated: pairs.length, statements };
}
