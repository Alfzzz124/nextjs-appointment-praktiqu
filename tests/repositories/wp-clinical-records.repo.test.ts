/**
 * Contract tests for the encounter-scoped clinical record reads.
 *
 * These back the encounter migration (E3/E4): a session note's body becomes
 * `wp_kc_medical_history` rows, and an intervention plan's items become
 * `wp_kc_prescription` rows. What matters here is ordering, batching, and the small
 * normalisations that stop KiviCare's `''`-for-unset convention leaking upwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../billing/fixtures';
import {
  HISTORY_TYPE,
  findPrescriptionById,
  isKnownHistoryType,
  listEncounterHistory,
  listEncounterPrescriptions,
  listHistoryForEncounters,
  listPrescriptionsForEncounters,
} from '@/repositories/wp/clinical-records.repo';

/** Test-owned range, in the convention the sibling repository suites use. */
const BASE = 8_700_000;
const END = BASE + 100_000;

const ENCOUNTER = BASE + 1;
const OTHER_ENCOUNTER = BASE + 2;
const EMPTY_ENCOUNTER = BASE + 3;
const PATIENT = BASE + 50;
const DOCTOR = BASE + 60;

async function wipe() {
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_medical_history WHERE id >= ? AND id < ?`, BASE, END,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_prescription WHERE id >= ? AND id < ?`, BASE, END,
  );
}

async function seedHistory(id: number, encounterId: number, type: string, title: string) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_medical_history
       (id, encounter_id, patient_id, type, title, added_by, created_at, is_from_template)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), 0)`,
    id, encounterId, PATIENT, type, title, DOCTOR,
  );
}

async function seedPrescription(
  id: number,
  encounterId: number,
  name: string,
  frequency: string,
  duration: string,
  instruction: string,
) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_prescription
       (id, encounter_id, patient_id, name, frequency, duration, instruction, added_by, created_at, is_from_template)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 0)`,
    id, encounterId, PATIENT, name, frequency, duration, instruction, DOCTOR,
  );
}

beforeAll(async () => {
  assertTestDb();
  await wipe();

  // Inserted out of order on purpose — the reads must impose the order, not inherit it.
  await seedHistory(BASE + 12, ENCOUNTER, HISTORY_TYPE.NOTE, 'Klien tampak lebih tenang');
  await seedHistory(BASE + 10, ENCOUNTER, HISTORY_TYPE.PROBLEM, 'Kecemasan sosial');
  await seedHistory(BASE + 11, ENCOUNTER, HISTORY_TYPE.OBSERVATION, 'Kontak mata membaik');
  await seedHistory(BASE + 20, OTHER_ENCOUNTER, HISTORY_TYPE.NOTE, 'Encounter lain');

  await seedPrescription(BASE + 30, ENCOUNTER, 'Journaling', '3x seminggu', '30 hari', 'Sebelum tidur');
  await seedPrescription(BASE + 31, ENCOUNTER, 'Latihan napas', '', '', '');
  await seedPrescription(BASE + 40, OTHER_ENCOUNTER, 'Resep lain', '1x', '7 hari', '');
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('medical history', () => {
  it('reads an encounter’s entries in writing order', async () => {
    const rows = await listEncounterHistory(ENCOUNTER);

    // Ascending by id: these read as a narrative, so insertion order is the right order.
    expect(rows.map((r) => r.id)).toEqual([BASE + 10, BASE + 11, BASE + 12]);
    expect(rows[0].title).toBe('Kecemasan sosial');
    expect(rows[0].type).toBe('problem');
    expect(rows[0].patientId).toBe(PATIENT);
  });

  it('does not leak another encounter’s entries', async () => {
    const rows = await listEncounterHistory(ENCOUNTER);
    expect(rows.every((r) => r.encounterId === ENCOUNTER)).toBe(true);
  });

  it('filters by type', async () => {
    const rows = await listEncounterHistory(ENCOUNTER, { type: HISTORY_TYPE.OBSERVATION });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Kontak mata membaik');
  });

  it('returns an empty list for an encounter with nothing recorded', async () => {
    expect(await listEncounterHistory(EMPTY_ENCOUNTER)).toEqual([]);
  });

  it('surfaces an unfamiliar type rather than hiding the row', async () => {
    // The column has no constraint, so an add-on can write anything. Dropping a
    // clinician's row because we do not recognise its label would be worse.
    await seedHistory(BASE + 15, ENCOUNTER, 'addon_custom', 'Ditulis add-on');

    const rows = await listEncounterHistory(ENCOUNTER);
    const odd = rows.find((r) => r.id === BASE + 15);
    expect(odd?.title).toBe('Ditulis add-on');
    expect(isKnownHistoryType(odd!.type)).toBe(false);
    expect(isKnownHistoryType('note')).toBe(true);
  });

  it('batches several encounters into one grouped read', async () => {
    const grouped = await listHistoryForEncounters([ENCOUNTER, OTHER_ENCOUNTER, EMPTY_ENCOUNTER]);

    expect(grouped.get(OTHER_ENCOUNTER)!.map((r) => r.title)).toEqual(['Encounter lain']);
    // An encounter with no rows is simply absent, not an empty array to guard against.
    expect(grouped.has(EMPTY_ENCOUNTER)).toBe(false);
  });

  it('returns nothing — not everything — for an empty id list', async () => {
    expect((await listHistoryForEncounters([])).size).toBe(0);
  });
});

describe('prescriptions', () => {
  it('reads an encounter’s items', async () => {
    const rows = await listEncounterPrescriptions(ENCOUNTER);

    expect(rows.map((r) => r.id)).toEqual([BASE + 30, BASE + 31]);
    expect(rows[0].name).toBe('Journaling');
    expect(rows[0].frequency).toBe('3x seminggu');
    expect(rows[0].duration).toBe('30 hari');
    expect(rows[0].instruction).toBe('Sebelum tidur');
  });

  it('normalises KiviCare’s empty strings to null', async () => {
    // KiviCare writes '' for an unset field; a caller checking `!== null` must not be
    // fooled into rendering a blank.
    const rows = await listEncounterPrescriptions(ENCOUNTER);
    const bare = rows.find((r) => r.id === BASE + 31)!;

    expect(bare.name).toBe('Latihan napas');
    expect(bare.frequency).toBeNull();
    expect(bare.duration).toBeNull();
    expect(bare.instruction).toBeNull();
  });

  it('finds one by id', async () => {
    const p = await findPrescriptionById(BASE + 30);
    expect(p!.name).toBe('Journaling');
    expect(p!.encounterId).toBe(ENCOUNTER);
  });

  it('returns null for an unknown id', async () => {
    expect(await findPrescriptionById(BASE + 999)).toBeNull();
  });

  it('batches several encounters', async () => {
    const grouped = await listPrescriptionsForEncounters([ENCOUNTER, OTHER_ENCOUNTER]);

    expect(grouped.get(ENCOUNTER)).toHaveLength(2);
    expect(grouped.get(OTHER_ENCOUNTER)!.map((r) => r.name)).toEqual(['Resep lain']);
  });

  it('returns nothing for an empty id list', async () => {
    expect((await listPrescriptionsForEncounters([])).size).toBe(0);
  });
});
