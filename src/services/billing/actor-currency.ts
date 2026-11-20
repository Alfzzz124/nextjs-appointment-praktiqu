/**
 * Mata uang yang dipakai satu pengguna di layar uang (tagihan, statistik, laporan).
 *
 * Ini angka TAMPILAN, bukan angka yang ditagih. Yang ditagih tetap dihitung satu fungsi
 * di `intl-pricing.ts`, dan harga layanan tetap dikirim backend sebagai `priceUsd`. Di
 * sini backend hanya menyebut mata uang dan kursnya; FE yang memformat, dan menandai
 * angka historis dengan `≈` karena konversi dengan kurs hari ini memang perkiraan.
 *
 * Spec: docs/superpowers/specs/2026-11-18-harga-layanan-dolar-design.md §3, §4
 */
import type { KcActor } from '@/services/billing/kc-actor';
import { resolveClinicPaymentManyForDisplay } from '@/services/payments/clinic-payment.service';
import { currencyBlockFor, type CurrencyBlock } from '@/services/service-catalog/service';

/** Rupiah: jawaban yang benar saat tidak ada satu klinik yang sedang dilihat. */
export const IDR: CurrencyBlock = { code: 'IDR', fxRate: null };

/**
 * `kc.clinicId` sudah diisi untuk CLINIC_ADMIN, RECEPTIONIST dan PROFESSIONAL, dan untuk
 * SUPER_ADMIN hanya kalau ia sedang memilih satu klinik. Tanpa itu jawabannya rupiah:
 * angka lintas-klinik tidak punya satu kurs yang benar.
 *
 * Tidak pernah melempar — `resolveClinicPaymentManyForDisplay` sudah gagal-tertutup.
 */
export async function currencyForActor(kc: KcActor): Promise<CurrencyBlock> {
  if (kc.clinicId === null) return IDR;
  const clinicId = Number(kc.clinicId);
  if (!Number.isSafeInteger(clinicId) || clinicId <= 0) return IDR;
  const settings = (await resolveClinicPaymentManyForDisplay([clinicId])).get(clinicId);
  return settings === undefined ? IDR : currencyBlockFor(settings);
}
