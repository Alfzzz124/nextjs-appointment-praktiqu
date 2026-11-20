/**
 * Penanda harga dolar di `wp_kc_service_doctor_mapping.extra`.
 *
 * Spec: docs/superpowers/specs/2026-11-18-harga-layanan-dolar-design.md §1
 */
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  formatUsd,
  idrFromUsd,
  parseUsdInput,
  readUsdPrice,
  withUsdPrice,
} from '@/repositories/wp/usd-price-marker';

const D = (s: string) => new Prisma.Decimal(s);

describe('readUsdPrice', () => {
  it('membaca harga yang sah', () => {
    expect(readUsdPrice('{"praktiqu_price_usd":"55.00"}')?.toFixed(2)).toBe('55.00');
  });

  it('0.00 sah dan berarti gratis, bukan tidak ada', () => {
    expect(readUsdPrice('{"praktiqu_price_usd":"0.00"}')?.toFixed(2)).toBe('0.00');
  });

  it('hidup berdampingan dengan penanda opsi durasi', () => {
    const extra = '{"praktiqu_duration_of":12,"praktiqu_price_usd":"30.00"}';
    expect(readUsdPrice(extra)?.toFixed(2)).toBe('30.00');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['kosong', ''],
    ['bukan JSON', 'bukan json'],
    ['array', '[1,2]'],
    ['bukan objek', '"55.00"'],
    ['kunci tidak ada', '{"product_id":9}'],
    ['number, bukan string', '{"praktiqu_price_usd":55}'],
    ['tiga desimal', '{"praktiqu_price_usd":"55.123"}'],
    ['di atas batas', '{"praktiqu_price_usd":"100000.01"}'],
    ['negatif', '{"praktiqu_price_usd":"-1.00"}'],
    ['notasi ilmiah', '{"praktiqu_price_usd":"1e3"}'],
  ])('%s dibaca sebagai tidak ada', (_label, extra) => {
    expect(readUsdPrice(extra as string | null | undefined)).toBeNull();
  });
});

describe('withUsdPrice', () => {
  it('mempertahankan penanda opsi durasi', () => {
    const parsed = JSON.parse(withUsdPrice('{"praktiqu_duration_of":12}', D('30')));
    expect(parsed.praktiqu_duration_of).toBe(12);
    expect(parsed.praktiqu_price_usd).toBe('30.00');
  });

  it('mempertahankan product_id warisan', () => {
    const parsed = JSON.parse(withUsdPrice('{"product_id":"771"}', D('5.5')));
    expect(parsed.product_id).toBe('771');
    expect(parsed.praktiqu_price_usd).toBe('5.50');
  });

  it('null membuang kuncinya dan menyisakan sisanya', () => {
    const extra = '{"praktiqu_duration_of":12,"praktiqu_price_usd":"30.00"}';
    const parsed = JSON.parse(withUsdPrice(extra, null));
    expect(parsed.praktiqu_duration_of).toBe(12);
    expect('praktiqu_price_usd' in parsed).toBe(false);
  });

  it('extra kosong menghasilkan objek berisi satu kunci', () => {
    expect(JSON.parse(withUsdPrice(null, D('1')))).toEqual({ praktiqu_price_usd: '1.00' });
  });

  it('extra yang tidak terbaca diganti objek baru', () => {
    expect(JSON.parse(withUsdPrice('rusak', D('1')))).toEqual({ praktiqu_price_usd: '1.00' });
  });

  it('hasilnya bisa dibaca kembali oleh readUsdPrice', () => {
    expect(readUsdPrice(withUsdPrice('{"product_id":"771"}', D('12.3')))?.toFixed(2)).toBe('12.30');
  });
});

describe('parseUsdInput', () => {
  it.each(['55', '55.0', '55.00', '0', '0.00', '100000.00', ' 55.00 '])('menerima %s', (raw) => {
    expect(parseUsdInput(raw)).not.toBeNull();
  });

  it.each([55, '55.123', '-1', '', ' ', 'abc', '100000.01', '1e3', '.5', '+5', '55.', null, undefined])(
    'menolak %s',
    (raw) => {
      expect(parseUsdInput(raw)).toBeNull();
    },
  );
});

describe('formatUsd', () => {
  it('selalu dua desimal', () => {
    expect(formatUsd(D('5'))).toBe('5.00');
    expect(formatUsd(D('5.1'))).toBe('5.10');
  });
});

describe('idrFromUsd', () => {
  it('membulatkan setengah ke atas', () => {
    expect(idrFromUsd(D('55.00'), D('16500'))).toBe(907500);
    expect(idrFromUsd(D('1.00'), D('16432.75'))).toBe(16433);
  });

  it('nol tetap nol', () => {
    expect(idrFromUsd(D('0.00'), D('16500'))).toBe(0);
  });

  it('tidak merayap walau diturunkan sepuluh kali', () => {
    const hasil = Array.from({ length: 10 }, () => idrFromUsd(D('55.00'), D('16500')));
    expect(new Set(hasil).size).toBe(1);
    expect(hasil[0]).toBe(907500);
  });
});
