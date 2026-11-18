/**
 * Stempel ulang cermin rupiah: satu pernyataan per 200 baris, dan hanya baris yang
 * benar-benar ber-harga-dolar.
 *
 * Spec: docs/superpowers/specs/2026-11-18-harga-layanan-dolar-design.md §1
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../billing/fixtures';
import { idBlock } from '../helpers/id-blocks';
import { withUsdPrice } from '@/repositories/wp/usd-price-marker';
import { RESTAMP_BATCH, restampClinicPrices } from '@/services/practice/restamp-prices';

const { BASE, END } = idBlock('services/practice.restamp-prices.test.ts');
const CLINIC = BASE + 600;
const OTHER_CLINIC = BASE + 601;
const DOCTOR = BASE + 500;

/** 450 baris ber-harga-dolar: lebih dari dua batch penuh. */
const USD_ROWS = 450;

const D = (s: string) => new Prisma.Decimal(s);

async function mapping(id: number, clinicId: number, charges: string, extra: string | null): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_service_doctor_mapping
       (id, service_id, doctor_id, clinic_id, charges, duration, telemed_service, status, is_public, extra, created_at)
     VALUES (?, ?, ?, ?, ?, 60, 'no', 1, 1, ?, NOW())`,
    id,
    BASE + 1,
    DOCTOR,
    clinicId,
    charges,
    extra,
  );
}

const PLAIN = BASE + 9000; // rupiah saja, klinik yang sama
const NOTE = BASE + 9001; // extra berisi teks bebas
const OTHER = BASE + 9002; // ber-harga-dolar tapi klinik lain

async function wipe(): Promise<void> {
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_service_doctor_mapping WHERE id BETWEEN ? AND ?`, BASE, END);
}

beforeAll(async () => {
  await assertTestDb();
  await wipe();

  for (let i = 0; i < USD_ROWS; i += 1) {
    await mapping(BASE + 1000 + i, CLINIC, '0', withUsdPrice(null, D('55')));
  }
  await mapping(PLAIN, CLINIC, '425000', null);
  await mapping(NOTE, CLINIC, '100000', 'catatan admin: jangan dihapus');
  await mapping(OTHER, OTHER_CLINIC, '0', withUsdPrice(null, D('55')));
});

afterAll(wipe);

describe('restampClinicPrices', () => {
  it('menulis ulang semua baris ber-harga-dolar dalam 3 pernyataan, bukan 450', async () => {
    const result = await restampClinicPrices(CLINIC, D('16500'));

    expect(result.updated).toBe(USD_ROWS);
    expect(result.statements).toBe(Math.ceil(USD_ROWS / RESTAMP_BATCH));
    expect(result.statements).toBe(3);
  });

  it('rupiahnya benar-benar turunan dolar pada kurs itu', async () => {
    await restampClinicPrices(CLINIC, D('16500'));

    const row = await prisma.kcServiceDoctorMapping.findUnique({
      where: { id: BigInt(BASE + 1000) },
      select: { charges: true },
    });
    expect(row!.charges).toBe('907500');
  });

  it('kurs baru menggeser semuanya lagi, tanpa merayap', async () => {
    await restampClinicPrices(CLINIC, D('18000'));
    const a = await prisma.kcServiceDoctorMapping.findUnique({
      where: { id: BigInt(BASE + 1000) },
      select: { charges: true },
    });
    expect(a!.charges).toBe('990000');

    await restampClinicPrices(CLINIC, D('16500'));
    const b = await prisma.kcServiceDoctorMapping.findUnique({
      where: { id: BigInt(BASE + 1000) },
      select: { charges: true },
    });
    expect(b!.charges).toBe('907500');
  });

  it('tidak menyentuh baris rupiah maupun baris berisi teks bebas', async () => {
    await restampClinicPrices(CLINIC, D('18000'));

    const rows = await prisma.kcServiceDoctorMapping.findMany({
      where: { id: { in: [BigInt(PLAIN), BigInt(NOTE)] } },
      select: { id: true, charges: true, extra: true },
      orderBy: { id: 'asc' },
    });
    expect(rows[0].charges).toBe('425000');
    expect(rows[1].charges).toBe('100000');
    expect(rows[1].extra).toBe('catatan admin: jangan dihapus');
  });

  it('tidak menyentuh klinik lain', async () => {
    await restampClinicPrices(CLINIC, D('18000'));

    const row = await prisma.kcServiceDoctorMapping.findUnique({
      where: { id: BigInt(OTHER) },
      select: { charges: true },
    });
    expect(row!.charges).toBe('0');
  });

  it('klinik tanpa layanan ber-harga-dolar tidak mengirim satu pernyataan pun', async () => {
    const result = await restampClinicPrices(BASE + 999, D('16500'));
    expect(result).toEqual({ updated: 0, statements: 0 });
  });
});
