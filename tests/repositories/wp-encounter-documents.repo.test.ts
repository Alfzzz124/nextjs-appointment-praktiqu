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
  attachmentBelongsToAppointment,
  ENCOUNTER_DOC_MODULE_TYPE,
  linkReportToEncounter,
  listBookingAttachments,
  listLinkedReportIds,
  prepareUnlinkBatch,
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

  it('does not treat a stored `null` as report id 0', async () => {
    // json_encode(null) === 'null'; Number(null) is 0, which Number.isFinite
    // accepts, so a naive parser would report this row as a link to id 0.
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_custom_fields_data (module_type, module_id, fields_data, field_id, created_at)
       VALUES (?, ?, 'null', NULL, NOW())`,
      ENCOUNTER_DOC_MODULE_TYPE, ENCOUNTER,
    );

    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([]);
  });
});

describe('prepareUnlinkBatch', () => {
  it('unlinks each document in the prepared batch independently, on demand', async () => {
    await linkReportToEncounter(ENCOUNTER, REPORT_A);
    await linkReportToEncounter(ENCOUNTER, REPORT_B);

    const unlinkOne = await prepareUnlinkBatch([REPORT_A, REPORT_B]);
    expect(await unlinkOne(REPORT_A)).toBe(1);
    expect(await unlinkOne(REPORT_B)).toBe(1);

    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([]);
  });

  it('leaves a document not yet asked for completely linked', async () => {
    await linkReportToEncounter(ENCOUNTER, REPORT_A);
    await linkReportToEncounter(ENCOUNTER, REPORT_B);

    const unlinkOne = await prepareUnlinkBatch([REPORT_A, REPORT_B]);
    await unlinkOne(REPORT_A);

    // REPORT_B was part of the batch but never asked for — still linked.
    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([REPORT_B]);
  });

  it('a document outside the prepared batch is a no-op, not an error', async () => {
    await linkReportToEncounter(ENCOUNTER, REPORT_A);

    const unlinkOne = await prepareUnlinkBatch([REPORT_A]);
    expect(await unlinkOne(REPORT_B)).toBe(0);
    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([REPORT_A]);
  });
});

const APPOINTMENT = BASE + 500;
const APPOINTMENT_EMPTY = BASE + 501;
const APPOINTMENT_NULL = BASE + 502;
const MEDIA_A = BASE + 600;
const MEDIA_B = BASE + 601;
const MEDIA_GONE = BASE + 602;

async function wipeAppointments() {
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_appointments WHERE id >= ? AND id < ?`, BASE, END,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_posts WHERE ID >= ? AND ID < ?`, BASE, END,
  );
}

async function seedAttachment(id: number, file: string, mime: string) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_posts
       (ID, post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt,
        post_status, comment_status, ping_status, post_password, post_name, to_ping, pinged,
        post_modified, post_modified_gmt, post_content_filtered, post_parent, guid, menu_order,
        post_type, post_mime_type, comment_count)
     VALUES (?, 0, NOW(), NOW(), '', ?, '', 'inherit', 'closed', 'closed', '', ?, '', '',
             NOW(), NOW(), '', 0, ?, 0, 'attachment', ?, 0)`,
    id, file, file, `http://test.local/wp-content/uploads/kivicare-reports/${file}`, mime,
  );
}

async function seedAppointment(id: number, report: string | null) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_appointments
       (id, appointment_start_date, appointment_start_time, appointment_end_date,
        appointment_end_time, visit_type, clinic_id, doctor_id, patient_id, description,
        status, created_at, appointment_report)
     VALUES (?, CURDATE(), '09:00:00', CURDATE(), '10:00:00', '1', 1, 1, 1, '', 1, NOW(), ?)`,
    id, report,
  );
}

describe('booking attachments', () => {
  beforeAll(async () => {
    await wipeAppointments();
    await seedAttachment(MEDIA_A, 'hasil-tes.pdf', 'application/pdf');
    await seedAttachment(MEDIA_B, 'form-isian.png', 'image/png');
    await seedAppointment(APPOINTMENT, JSON.stringify([MEDIA_A, MEDIA_GONE, MEDIA_B]));
    await seedAppointment(APPOINTMENT_EMPTY, '[]');
    await seedAppointment(APPOINTMENT_NULL, null);
  });

  afterAll(async () => { await wipeAppointments(); });

  it('resolves each id to a filename and mime type, in stored order', async () => {
    const rows = await listBookingAttachments(APPOINTMENT);

    expect(rows.map((r) => r.mediaId)).toEqual([MEDIA_A, MEDIA_GONE, MEDIA_B]);
    expect(rows[0]).toMatchObject({
      filename: 'hasil-tes.pdf', mimeType: 'application/pdf', missing: false,
    });
    expect(rows[2]).toMatchObject({
      filename: 'form-isian.png', mimeType: 'image/png', missing: false,
    });
  });

  it('lists a deleted attachment as missing instead of dropping or throwing', async () => {
    const rows = await listBookingAttachments(APPOINTMENT);
    const gone = rows.find((r) => r.mediaId === MEDIA_GONE);

    expect(gone).toBeDefined();
    expect(gone!.missing).toBe(true);
    expect(gone!.mimeType).toBeNull();
  });

  it('returns nothing for an empty array, a NULL column, or an unknown appointment', async () => {
    expect(await listBookingAttachments(APPOINTMENT_EMPTY)).toEqual([]);
    expect(await listBookingAttachments(APPOINTMENT_NULL)).toEqual([]);
    expect(await listBookingAttachments(BASE + 999)).toEqual([]);
  });

  it('survives a column holding malformed JSON', async () => {
    const id = BASE + 503;
    await seedAppointment(id, 'not json at all');
    expect(await listBookingAttachments(id)).toEqual([]);
  });

  it('treats well-formed JSON that is not an array as no attachments', async () => {
    // Each of these parses cleanly — the try/catch never fires — so this is the
    // only thing that can exercise the `!Array.isArray(parsed)` guard.
    const NUMBER = BASE + 510;
    const OBJECT = BASE + 511;
    const STRING = BASE + 512;
    await seedAppointment(NUMBER, '42');
    await seedAppointment(OBJECT, '{}');
    await seedAppointment(STRING, '"x"');

    expect(await listBookingAttachments(NUMBER)).toEqual([]);
    expect(await listBookingAttachments(OBJECT)).toEqual([]);
    expect(await listBookingAttachments(STRING)).toEqual([]);
  });

  it('de-duplicates an id repeated within one appointment_report array', async () => {
    const id = BASE + 513;
    await seedAppointment(id, JSON.stringify([MEDIA_A, MEDIA_A, MEDIA_B]));

    const rows = await listBookingAttachments(id);
    expect(rows.map((r) => r.mediaId)).toEqual([MEDIA_A, MEDIA_B]);
  });

  it('confirms membership only for ids actually in that appointment', async () => {
    expect(await attachmentBelongsToAppointment(APPOINTMENT, MEDIA_A)).toBe(true);
    expect(await attachmentBelongsToAppointment(APPOINTMENT, MEDIA_B)).toBe(true);
    // The guard that stops a valid session being used to read someone else's file.
    expect(await attachmentBelongsToAppointment(APPOINTMENT_EMPTY, MEDIA_A)).toBe(false);
    expect(await attachmentBelongsToAppointment(APPOINTMENT, BASE + 777)).toBe(false);
  });
});
