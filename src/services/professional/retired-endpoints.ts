/**
 * The retired `/professionals/{id}/services` **write** endpoints.
 *
 * These four wrote to `wp_kc_service_doctor_mapping`, the same table
 * `/api/v1/services` now owns. Keeping both was not a duplication of convenience — the
 * two disagreed on what the rules are:
 *
 *   - They never checked for upcoming appointments, so an admin refused a 409 by
 *     `DELETE /api/v1/services/{id}` could retire the offering anyway through here.
 *   - `unassignServiceFromDoctor` was called without a `clinicId`, so its UPDATE read
 *     `WHERE doctor_id = ? AND service_id = ?` with no clinic filter. A clinic admin
 *     retiring a service switched it off at *every* clinic that psychologist works at.
 *   - The assign path took `clinicId` straight from the request body with no check that
 *     the doctor works there, and a `?? 0` fallback that could write `clinic_id = 0`.
 *
 * The reads stay: `GET /professionals/{id}/services` and `.../services/export` are
 * harmless and still in use.
 *
 * Verified 2026-09-17 against the live front-end (`raakanaka/laravel-praktiqu`): its
 * `ServiceController` already POSTs, PUTs and DELETEs `/api/v1/services`, and nothing
 * calls these four. The only surviving mention is a comment in an artisan probe command.
 *
 * 410 rather than deleting the files outright, because an unknown caller deserves to be
 * told where to go rather than handed a bare 404. Delete them after SUNSET.
 */
import { NextResponse } from 'next/server';
import { gone } from '@/lib/problem-details';

/** When these handlers should be deleted outright. Bump it here, nowhere else. */
export const SUNSET = new Date('2026-12-01T00:00:00Z');

const REPLACEMENT = '/api/v1/services';

/**
 * The 410 body plus the headers that let a client notice without reading the body.
 *
 * `Sunset` is RFC 8594 and `Link ... rel="successor-version"` is RFC 8288; both are what
 * an HTTP client library will already understand.
 */
export function retiredEndpoint(replacement: string, detail: string): NextResponse {
  return NextResponse.json(
    {
      ...gone('endpoint_retired', detail),
      replacement,
      sunset: SUNSET.toISOString(),
    },
    {
      status: 410,
      headers: {
        Deprecation: 'true',
        Sunset: SUNSET.toUTCString(),
        Link: `<${REPLACEMENT}>; rel="successor-version"`,
      },
    },
  );
}

/**
 * Assigning an existing service is covered by `POST /api/v1/services`: when a catalogue
 * row with the same name and category already exists it is reused rather than duplicated,
 * so posting the same name attaches that service to the psychologist.
 */
export const assignRetired = () =>
  retiredEndpoint(
    'POST /api/v1/services',
    'Penugasan layanan sekarang lewat POST /api/v1/services. Kirim nama dan categoryId ' +
      'yang sama dengan layanan yang sudah ada — baris katalognya dipakai ulang, tidak ' +
      'diduplikasi. Endpoint ini tidak memverifikasi psikolog benar-benar bekerja di ' +
      'klinik yang dikirim, dan tidak bisa mengatur harga atau durasi.',
  );

export const unassignRetired = () =>
  retiredEndpoint(
    'DELETE /api/v1/services/{id}',
    'Pakai DELETE /api/v1/services/{id}, dengan {id} = id baris penawaran (mapping). ' +
      'Endpoint ini mematikan layanan di SEMUA klinik tempat psikolog itu bekerja, bukan ' +
      'hanya klinik Anda, dan tidak memeriksa janji temu yang belum jalan.',
  );

export const bulkDeleteRetired = () =>
  retiredEndpoint(
    'DELETE /api/v1/services/{id}',
    'Panggil DELETE /api/v1/services/{id} per baris. Endpoint ini melewati pemeriksaan ' +
      'janji temu mendatang dan mematikan layanan di semua klinik psikolog tersebut.',
  );

export const bulkStatusRetired = () =>
  retiredEndpoint(
    'PUT /api/v1/services/{id}',
    'Pakai PUT /api/v1/services/{id} dengan { "status": 0 } atau { "status": 1 } per ' +
      'baris. Menonaktifkan lewat endpoint ini melewati pemeriksaan janji temu mendatang.',
  );
