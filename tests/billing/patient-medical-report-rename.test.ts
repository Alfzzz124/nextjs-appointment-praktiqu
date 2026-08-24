/**
 * Rename touches the `name` column and nothing else. The file, the media id and the
 * encounter link are all untouched — a typo in a label is not a reason to disturb a
 * clinical document.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from './fixtures';
import { renameMedReport } from '@/services/billing/patient-medical-report.service';

const BASE = 8_900_000;
const END = BASE + 1_000;
const REPORT = BASE + 1;
const PATIENT = BASE + 50;

async function wipe() {
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_patient_medical_report WHERE id >= ? AND id < ?`, BASE, END,
  );
}

beforeEach(async () => {
  assertTestDb();
  await wipe();
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_patient_medical_report (id, name, patient_id, upload_report, date)
     VALUES (?, ?, ?, ?, NOW())`,
    REPORT, 'Salah ketik', PATIENT, '4242',
  );
});

afterAll(async () => { await wipe(); await prisma.$disconnect(); });

describe('renameMedReport', () => {
  it('changes the name and leaves the file alone', async () => {
    const out = await renameMedReport(REPORT, 'Resume sesi konseling', null);

    expect(out).toEqual({ id: REPORT, name: 'Resume sesi konseling' });

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT name, upload_report FROM wp_kc_patient_medical_report WHERE id = ?`, REPORT,
    );
    expect(rows[0].name).toBe('Resume sesi konseling');
    expect(rows[0].upload_report).toBe('4242');
  });

  it('trims the name', async () => {
    const out = await renameMedReport(REPORT, '  Resume  ', null);
    expect(out.name).toBe('Resume');
  });

  it('rejects an empty name rather than storing a blank label', async () => {
    await expect(renameMedReport(REPORT, '   ', null)).rejects.toMatchObject({ httpStatus: 400 });
  });

  it('404s for a document outside the caller’s scope', async () => {
    await expect(renameMedReport(REPORT, 'X', { patientId: BigInt(PATIENT + 1) }))
      .rejects.toMatchObject({ httpStatus: 404 });
  });

  it('404s for a document that does not exist', async () => {
    await expect(renameMedReport(BASE + 999, 'X', null)).rejects.toMatchObject({ httpStatus: 404 });
  });
});
