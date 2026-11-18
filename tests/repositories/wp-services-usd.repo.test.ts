/**
 * Harga dolar terbaca dari `extra` pada baris pemetaan, dan hidup berdampingan dengan
 * penanda opsi durasi yang memakai kolom yang sama.
 *
 * Spec: docs/superpowers/specs/2026-11-18-harga-layanan-dolar-design.md §1
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../billing/fixtures';
import { idBlock } from '../helpers/id-blocks';
import { optionMarker } from '@/repositories/wp/duration-option-marker';
import { withUsdPrice } from '@/repositories/wp/usd-price-marker';
import { Prisma } from '@prisma/client';
import { findMappingById, listOptionRowsOf } from '@/repositories/wp/services.repo';

const { BASE, END } = idBlock('repositories/wp-services-usd.repo.test.ts');
const D = BASE + 500;
const C = BASE + 600;

const S_PLAIN = BASE + 1;
const S_USD = BASE + 2;
const S_OPT = BASE + 3;
const S_JUNK = BASE + 4;

const PLAIN = BASE + 101; // rupiah saja
const USD = BASE + 102; // ber-harga-dolar
const OPT = BASE + 103; // opsi durasi YANG JUGA ber-harga-dolar
const JUNK = BASE + 104; // extra tidak terbaca

async function catalogue(id: number, name: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_services (id, name, type, category, price, status, created_at)
     VALUES (?, ?, 'konseling', '{}', '0', 1, NOW())`,
    id,
    name,
  );
}

async function mapping(id: number, serviceId: number, charges: string, extra: string | null): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_service_doctor_mapping
       (id, service_id, doctor_id, clinic_id, charges, duration, telemed_service, status, is_public, extra, created_at)
     VALUES (?, ?, ?, ?, ?, 60, 'no', 1, 1, ?, NOW())`,
    id,
    serviceId,
    D,
    C,
    charges,
    extra,
  );
}

beforeAll(async () => {
  await assertTestDb();
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_service_doctor_mapping WHERE id BETWEEN ? AND ?`, BASE, END);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_services WHERE id BETWEEN ? AND ?`, BASE, END);

  await catalogue(S_PLAIN, 'Konseling rupiah');
  await catalogue(S_USD, 'Konseling dolar');
  await catalogue(S_OPT, 'Konseling dolar 90 menit');
  await catalogue(S_JUNK, 'Konseling extra rusak');

  await mapping(PLAIN, S_PLAIN, '425000', null);
  await mapping(USD, S_USD, '907500', withUsdPrice(null, new Prisma.Decimal('55')));
  await mapping(OPT, S_OPT, '1237500', withUsdPrice(optionMarker(BigInt(USD)), new Prisma.Decimal('75')));
  await mapping(JUNK, S_JUNK, '100000', 'bukan json');
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_service_doctor_mapping WHERE id BETWEEN ? AND ?`, BASE, END);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_services WHERE id BETWEEN ? AND ?`, BASE, END);
});

describe('priceUsd pada baris pemetaan', () => {
  it('baris rupiah tidak punya harga dolar', async () => {
    const row = await findMappingById(BigInt(PLAIN));
    expect(row!.priceUsd).toBeNull();
  });

  it('baris ber-harga-dolar membawanya sebagai string 2 desimal', async () => {
    const row = await findMappingById(BigInt(USD));
    expect(row!.priceUsd).toBe('55.00');
  });

  it('extra yang tidak terbaca dibaca sebagai tidak ada, bukan melempar', async () => {
    const row = await findMappingById(BigInt(JUNK));
    expect(row!.priceUsd).toBeNull();
  });

  it('harga dolar dan penanda opsi durasi hidup berdampingan di satu baris', async () => {
    const row = await findMappingById(BigInt(OPT));
    expect(row!.priceUsd).toBe('75.00');
    expect(row!.optionOf).toEqual({ parentId: BigInt(USD), removed: false });
  });

  it('opsi yang diambil lewat induknya juga membawa harga dolarnya', async () => {
    const rows = await listOptionRowsOf([BigInt(USD)]);
    expect(rows.map((r) => r.priceUsd)).toEqual(['75.00']);
  });

  it('extra mentah ikut terbawa untuk jalur tulis', async () => {
    const row = await findMappingById(BigInt(OPT));
    expect(JSON.parse(row!.extra!)).toEqual({ praktiqu_duration_of: USD, praktiqu_price_usd: '75.00' });
  });
});
