/**
 * Contract tests for the encounter↔document link.
 *
 * The link is our own row inside KiviCare's custom-field table, so what matters
 * here is that it stays invisible to KiviCare (namespaced module_type, NULL
 * field_id) and that attach/detach are pure INSERT and DELETE — no
 * read-modify-write, which MyISAM cannot make safe.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../billing/fixtures';
import {
  ENCOUNTER_DOC_MODULE_TYPE,
  linkReportToEncounter,
  listLinkedReportIds,
  unlinkReport,
} from '@/repositories/wp/encounter-documents.repo';

const BASE = 8_800_000;
const END = BASE + 100_000;

const ENCOUNTER = BASE + 1;
const OTHER_ENCOUNTER = BASE + 2;
const REPORT_A = BASE + 10;
const REPORT_B = BASE + 11;
const REPORT_C = BASE + 12;
const REPORT_D = BASE + 13;

/** Raw row count for a (module_type, module_id, fields_data) triple — bypasses listLinkedReportIds' de-dup. */
async function rawRowCount(moduleId: number, fieldsData: string) {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id FROM wp_kc_custom_fields_data
       WHERE module_type = ? AND module_id = ? AND fields_data = ?`,
    ENCOUNTER_DOC_MODULE_TYPE, moduleId, fieldsData,
  );
  return rows.length;
}

async function wipe() {
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_custom_fields_data WHERE module_id >= ? AND module_id < ?`, BASE, END,
  );
}

beforeAll(async () => { assertTestDb(); await wipe(); });
beforeEach(async () => { await wipe(); });
afterAll(async () => { await wipe(); await prisma.$disconnect(); });

describe('encounter document links', () => {
  it('links a report and reads it back', async () => {
    await linkReportToEncounter(ENCOUNTER, REPORT_A);
    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([REPORT_A]);
  });

  it('writes a row KiviCare cannot see: namespaced module_type and NULL field_id', async () => {
    await linkReportToEncounter(ENCOUNTER, REPORT_A);

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT module_type, module_id, fields_data, field_id
         FROM wp_kc_custom_fields_data WHERE module_id = ?`, ENCOUNTER,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].module_type).toBe(ENCOUNTER_DOC_MODULE_TYPE);
    expect(rows[0].module_type).toBe('praktiqu_report_encounter');
    expect(rows[0].field_id).toBeNull();
    expect(Number(JSON.parse(rows[0].fields_data))).toBe(REPORT_A);
  });

  it('keeps each encounter’s links separate', async () => {
    await linkReportToEncounter(ENCOUNTER, REPORT_A);
    await linkReportToEncounter(OTHER_ENCOUNTER, REPORT_B);

    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([REPORT_A]);
    expect(await listLinkedReportIds(OTHER_ENCOUNTER)).toEqual([REPORT_B]);
  });

  it('returns ids in insertion order', async () => {
    await linkReportToEncounter(ENCOUNTER, REPORT_C);
    await linkReportToEncounter(ENCOUNTER, REPORT_A);
    await linkReportToEncounter(ENCOUNTER, REPORT_B);

    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([REPORT_C, REPORT_A, REPORT_B]);
  });

  it('is idempotent — linking twice does not duplicate the row', async () => {
    await linkReportToEncounter(ENCOUNTER, REPORT_A);
    await linkReportToEncounter(ENCOUNTER, REPORT_A);

    // Assert on the raw table, not on listLinkedReportIds: that read de-duplicates
    // by value, so it would report one id even if the guard let two rows through.
    expect(await rawRowCount(ENCOUNTER, JSON.stringify(REPORT_A))).toBe(1);
  });

  it('recognizes a report id already stored as a JSON string and does not duplicate it', async () => {
    // Seed a row in the "other" shape: fields_data = '"8800013"' rather than '8800013'.
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_custom_fields_data (module_type, module_id, fields_data, field_id, created_at)
       VALUES (?, ?, ?, NULL, NOW())`,
      ENCOUNTER_DOC_MODULE_TYPE, ENCOUNTER, JSON.stringify(String(REPORT_D)),
    );

    await linkReportToEncounter(ENCOUNTER, REPORT_D);

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT fields_data FROM wp_kc_custom_fields_data
         WHERE module_type = ? AND module_id = ?`,
      ENCOUNTER_DOC_MODULE_TYPE, ENCOUNTER,
    );
    expect(rows).toHaveLength(1);
  });

  it('unlinks a report id stored as a JSON string', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_custom_fields_data (module_type, module_id, fields_data, field_id, created_at)
       VALUES (?, ?, ?, NULL, NOW())`,
      ENCOUNTER_DOC_MODULE_TYPE, ENCOUNTER, JSON.stringify(String(REPORT_D)),
    );

    expect(await unlinkReport(REPORT_D)).toBe(1);
    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([]);
  });

  it('unlinks by report id and reports how many rows went', async () => {
    await linkReportToEncounter(ENCOUNTER, REPORT_A);
    await linkReportToEncounter(ENCOUNTER, REPORT_B);

    expect(await unlinkReport(REPORT_A)).toBe(1);
    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([REPORT_B]);
  });

  it('unlinking a report that was never linked is a no-op, not an error', async () => {
    expect(await unlinkReport(REPORT_C)).toBe(0);
  });

  it('tolerates duplicate rows written by an older build', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_custom_fields_data (module_type, module_id, fields_data, field_id, created_at)
       VALUES (?, ?, ?, NULL, NOW()), (?, ?, ?, NULL, NOW())`,
      ENCOUNTER_DOC_MODULE_TYPE, ENCOUNTER, JSON.stringify(REPORT_A),
      ENCOUNTER_DOC_MODULE_TYPE, ENCOUNTER, JSON.stringify(REPORT_A),
    );

    // The read de-duplicates rather than reporting the document twice.
    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([REPORT_A]);
    // And unlinking clears both.
    expect(await unlinkReport(REPORT_A)).toBe(2);
    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([]);
  });

  it('ignores rows belonging to other module types', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_custom_fields_data (module_type, module_id, fields_data, field_id, created_at)
       VALUES ('patient_encounter_module', ?, ?, NULL, NOW())`,
      ENCOUNTER, JSON.stringify(REPORT_C),
    );

    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([]);
  });

  it('unlinkReport is scoped by module_type — it leaves rows from other modules alone', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_custom_fields_data (module_type, module_id, fields_data, field_id, created_at)
       VALUES ('patient_encounter_module', ?, ?, NULL, NOW())`,
      ENCOUNTER, JSON.stringify(REPORT_A),
    );

    expect(await unlinkReport(REPORT_A)).toBe(0);

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM wp_kc_custom_fields_data
         WHERE module_type = 'patient_encounter_module' AND module_id = ?`,
      ENCOUNTER,
    );
    expect(rows).toHaveLength(1);
  });
});
