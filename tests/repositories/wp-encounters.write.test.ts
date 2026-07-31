/**
 * Encounter writes go through the praktiqu-endpoint plugin, never Prisma.
 *
 * The reason is `kc_encounter_closed`: KiviCare registers a listener that mails the
 * patient their notes and prescription, but fires that action nowhere in core or Pro.
 * Our plugin route fires it, so closing has to travel that path — a Prisma update
 * would change the column and notify nobody.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const wp = vi.hoisted(() => ({ wpRequestJson: vi.fn() }));
vi.mock('@/lib/wp-endpoint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wp-endpoint')>()),
  ...wp,
}));

import {
  ENCOUNTER_STATUS,
  HISTORY_TYPE,
  closeEncounter,
  createEncounter,
  replaceEncounterHistory,
  replaceEncounterPrescriptions,
  setEncounterStatus,
  updateEncounter,
} from '@/repositories/wp/encounters.write';

const ENCOUNTER = 4102;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createEncounter', () => {
  it('posts the snake_case body the plugin expects', async () => {
    wp.wpRequestJson.mockResolvedValue({
      id: ENCOUNTER, clinic_id: 3, doctor_id: 29, patient_id: 461, appointment_id: 5150, status: 1,
    });

    const created = await createEncounter({
      clinicId: 3, doctorId: 29, patientId: 461, appointmentId: 5150, addedBy: 29,
    });

    expect(created.id).toBe(ENCOUNTER);
    const [path, init] = wp.wpRequestJson.mock.calls[0];
    expect(path).toBe('/encounters');
    expect(init.method).toBe('POST');
    expect(init.body).toMatchObject({
      clinic_id: 3, doctor_id: 29, patient_id: 461, appointment_id: 5150, added_by: 29,
    });
  });

  it('always sends added_by, since the plugin has no logged-in user to fall back on', async () => {
    // A service-token request would otherwise record author 0 and lose the clinician.
    wp.wpRequestJson.mockResolvedValue({
      id: ENCOUNTER, clinic_id: 3, doctor_id: 29, patient_id: 461, appointment_id: 0, status: 1,
    });

    await createEncounter({ clinicId: 3, doctorId: 29, patientId: 461, addedBy: 77 });

    expect(wp.wpRequestJson.mock.calls[0][1].body.added_by).toBe(77);
  });

  it('rejects a response with no id rather than returning NaN', async () => {
    wp.wpRequestJson.mockResolvedValue({ ok: true });
    await expect(
      createEncounter({ clinicId: 3, doctorId: 29, patientId: 461 }),
    ).rejects.toThrow(/no id/i);
  });
});

describe('status changes', () => {
  it('closes through the status route, not a column update', async () => {
    wp.wpRequestJson.mockResolvedValue({ id: ENCOUNTER, status: 0, closed: true, notified: true });

    const res = await closeEncounter(ENCOUNTER);

    expect(wp.wpRequestJson).toHaveBeenCalledWith(
      `/encounters/${ENCOUNTER}/status`,
      expect.objectContaining({ method: 'POST', body: { status: ENCOUNTER_STATUS.CLOSED } }),
    );
    expect(res.notified).toBe(true);
  });

  it('reports notified=false when the encounter has no appointment', async () => {
    // The listener resolves the patient through the appointment, so there is nobody
    // to mail — the caller should be able to tell that apart from a successful send.
    wp.wpRequestJson.mockResolvedValue({ id: ENCOUNTER, status: 0, closed: true, notified: false });

    expect((await closeEncounter(ENCOUNTER)).notified).toBe(false);
  });

  it('reopens with status 1', async () => {
    wp.wpRequestJson.mockResolvedValue({ id: ENCOUNTER, status: 1, closed: false, notified: false });

    await setEncounterStatus(ENCOUNTER, ENCOUNTER_STATUS.OPEN);

    expect(wp.wpRequestJson.mock.calls[0][1].body).toEqual({ status: 1 });
  });
});

describe('updateEncounter', () => {
  it('sends only the encounter’s own columns', async () => {
    wp.wpRequestJson.mockResolvedValue({ id: ENCOUNTER, updated: ['description'] });

    await updateEncounter(ENCOUNTER, { description: 'Sesi berjalan baik' });

    const [path, init] = wp.wpRequestJson.mock.calls[0];
    expect(path).toBe(`/encounters/${ENCOUNTER}`);
    expect(init.method).toBe('PUT');
    expect(init.body).toEqual({ description: 'Sesi berjalan baik', encounter_date: undefined });
  });
});

describe('children', () => {
  it('replaces history entries with KiviCare’s own type vocabulary', async () => {
    wp.wpRequestJson.mockResolvedValue({ encounter_id: ENCOUNTER, entries: 2 });

    await replaceEncounterHistory({
      encounterId: ENCOUNTER,
      patientId: 461,
      addedBy: 29,
      entries: [
        { type: HISTORY_TYPE.OBSERVATION, title: 'Klien tampak cemas' },
        { type: HISTORY_TYPE.NOTE, title: 'Lanjut sesi mingguan' },
      ],
    });

    const [path, init] = wp.wpRequestJson.mock.calls[0];
    expect(path).toBe(`/encounters/${ENCOUNTER}/history`);
    // PUT, because editing a note rewrites its entries wholesale — appending would
    // duplicate them on every save.
    expect(init.method).toBe('PUT');
    expect(init.body.entries.map((e: { type: string }) => e.type)).toEqual(['observation', 'note']);
    expect(init.body.patient_id).toBe(461);
  });

  it('pins the three types KiviCare understands', () => {
    // SOAP is gone; these are what its UI, templates and print views render.
    expect(Object.values(HISTORY_TYPE)).toEqual(['problem', 'observation', 'note']);
  });

  it('replaces prescriptions with the recommendation fields', async () => {
    wp.wpRequestJson.mockResolvedValue({ encounter_id: ENCOUNTER, ids: [1] });

    await replaceEncounterPrescriptions({
      encounterId: ENCOUNTER,
      patientId: 461,
      addedBy: 29,
      items: [{ name: 'Journaling', frequency: '3x seminggu', duration: '30 hari', instruction: 'Sebelum tidur' }],
    });

    const [path, init] = wp.wpRequestJson.mock.calls[0];
    expect(path).toBe(`/encounters/${ENCOUNTER}/prescriptions`);
    expect(init.method).toBe('PUT');
    expect(init.body.items[0]).toEqual({
      name: 'Journaling', frequency: '3x seminggu', duration: '30 hari', instruction: 'Sebelum tidur',
    });
  });
});
