/**
 * SessionNoteService — a note IS a KiviCare encounter (phase E3).
 *
 * The mapping is the thing worth pinning: note ↔ encounter for the session's
 * appointment, body ↔ description + typed medical_history entries, OPEN/CLOSED ↔
 * status 1/0, and a summary derived on read rather than stored.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/repositories/wp/sessions.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/sessions.repo')>()),
  findSessionById: vi.fn(),
}));
vi.mock('@/repositories/wp/clinical-records.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/clinical-records.repo')>()),
  findEncounterByAppointmentId: vi.fn(),
  findEncounterById: vi.fn(),
  listEncounterHistory: vi.fn(),
  listEncounters: vi.fn(),
  listHistoryForEncounters: vi.fn(),
}));
vi.mock('@/repositories/wp/encounters.write', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/encounters.write')>()),
  createEncounter: vi.fn(),
  updateEncounter: vi.fn(),
  closeEncounter: vi.fn(),
  replaceEncounterHistory: vi.fn(),
}));
vi.mock('@/lib/logging', () => ({
  logging: { audit: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn(), warn: vi.fn() },
}));

import { SessionNoteAccessError, SessionNoteService } from '@/services/session-notes/service';
import { findSessionById } from '@/repositories/wp/sessions.repo';
import {
  findEncounterByAppointmentId,
  findEncounterById,
  listEncounterHistory,
} from '@/repositories/wp/clinical-records.repo';
import {
  closeEncounter,
  createEncounter,
  replaceEncounterHistory,
} from '@/repositories/wp/encounters.write';

const SESSION = 5150;
const ENCOUNTER = 91;
const DOCTOR = 29;
const CLIENT = 461;
const CLINIC = 3;

function session(status = 'CHECK_IN') {
  return {
    id: SESSION,
    clinicId: CLINIC,
    professionalId: DOCTOR,
    clientId: CLIENT,
    status,
    slotDate: '2026-07-15',
  } as never;
}

function encounter(status = 1) {
  return {
    id: ENCOUNTER,
    clinicId: CLINIC,
    doctorId: DOCTOR,
    patientId: CLIENT,
    appointmentId: SESSION,
    description: 'Sesi berjalan lancar',
    status,
    addedBy: DOCTOR,
    encounterDate: null,
    createdAt: new Date('2026-07-15T00:00:00Z'),
  } as never;
}

const professional = {
  actor: {
    userId: 'cuid-auth',
    wpUserId: DOCTOR,
    role: 'PROFESSIONAL' as const,
    ip: null,
    userAgent: null,
    requestId: null,
  },
  clinicId: CLINIC,
};

let service: SessionNoteService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new SessionNoteService();
  vi.mocked(findSessionById).mockResolvedValue(session());
  vi.mocked(findEncounterByAppointmentId).mockResolvedValue(null);
  vi.mocked(findEncounterById).mockResolvedValue(encounter());
  vi.mocked(listEncounterHistory).mockResolvedValue([
    { type: 'problem', title: 'Kecemasan sosial' },
  ] as never);
  vi.mocked(createEncounter).mockResolvedValue({ id: ENCOUNTER, status: 1 } as never);
});

describe('create', () => {
  it('creates the encounter for the session’s appointment', async () => {
    await service.create(
      { sessionId: String(SESSION), content: 'Sesi berjalan lancar' },
      professional,
    );

    const args = vi.mocked(createEncounter).mock.calls[0][0];
    expect(args.appointmentId).toBe(SESSION);
    expect(args.clinicId).toBe(CLINIC);
    expect(args.doctorId).toBe(DOCTOR);
    expect(args.patientId).toBe(CLIENT);
    // Credits the clinician: without it the plugin records get_current_user_id() = 0
    // for a service-token request and the author is lost.
    expect(args.addedBy).toBe(DOCTOR);
  });

  it('writes typed entries as medical history', async () => {
    await service.create(
      {
        sessionId: String(SESSION),
        entries: [
          { type: 'problem', title: 'Kecemasan sosial' },
          { type: 'note', title: 'Klien lebih terbuka' },
        ],
      },
      professional,
    );

    const args = vi.mocked(replaceEncounterHistory).mock.calls[0][0];
    expect(args.encounterId).toBe(ENCOUNTER);
    expect(args.entries).toEqual([
      { type: 'problem', title: 'Kecemasan sosial' },
      { type: 'note', title: 'Klien lebih terbuka' },
    ]);
  });

  it('drops an entry whose text is only whitespace', async () => {
    // It would render as a blank row in KiviCare's encounter view.
    await service.create(
      {
        sessionId: String(SESSION),
        content: 'x',
        entries: [{ type: 'note', title: '   ' }],
      },
      professional,
    );
    expect(replaceEncounterHistory).not.toHaveBeenCalled();
  });

  it('409s when KiviCare already has an encounter for that appointment', async () => {
    // Their own UI may have created it — that is a conflict, not a second note.
    vi.mocked(findEncounterByAppointmentId).mockResolvedValue(encounter());

    await expect(
      service.create({ sessionId: String(SESSION), content: 'x' }, professional),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('404s for an unknown session', async () => {
    vi.mocked(findSessionById).mockResolvedValue(null);
    await expect(
      service.create({ sessionId: String(SESSION), content: 'x' }, professional),
    ).rejects.toBeInstanceOf(SessionNoteAccessError);
  });

  it('refuses a professional who is not on the session', async () => {
    const other = { ...professional, actor: { ...professional.actor, wpUserId: DOCTOR + 1 } };
    await expect(
      service.create({ sessionId: String(SESSION), content: 'x' }, other),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a session that has not been attended', async () => {
    vi.mocked(findSessionById).mockResolvedValue(session('BOOKED'));
    await expect(
      service.create({ sessionId: String(SESSION), content: 'x' }, professional),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe('read', () => {
  it('rebuilds the note from the encounter, deriving the summary', async () => {
    const note = await service.getById(ENCOUNTER, professional);

    expect(note.id).toBe(ENCOUNTER);
    expect(note.sessionId).toBe(String(SESSION));
    expect(note.professionalId).toBe(String(DOCTOR));
    expect(note.status).toBe('OPEN');
    // Description and entries flattened into one searchable body.
    expect(note.content).toContain('Sesi berjalan lancar');
    expect(note.content).toContain('PROBLEM: Kecemasan sosial');
    // Derived, not stored — there is no summary column on an encounter.
    expect(note.summary).toBe(note.content.replace(/\s+/g, ' ').trim());
  });

  it('reports a closed encounter as CLOSED', async () => {
    vi.mocked(findEncounterById).mockResolvedValue(encounter(0));
    expect((await service.getById(ENCOUNTER, professional)).status).toBe('CLOSED');
  });

  it('refuses another professional’s note', async () => {
    const other = { ...professional, actor: { ...professional.actor, wpUserId: DOCTOR + 1 } };
    await expect(service.getById(ENCOUNTER, other)).rejects.toMatchObject({ status: 403 });
  });
});

describe('close', () => {
  it('closes through the plugin, which is what fires kc_encounter_closed', async () => {
    // That listener mails the patient their notes and prescription. Nothing in KiviCare
    // core or Pro ever triggered it, so the email had never been sent by anyone.
    vi.mocked(findEncounterById)
      .mockResolvedValueOnce(encounter(1))
      .mockResolvedValueOnce(encounter(0));

    const closed = await service.close(ENCOUNTER, professional);

    expect(closeEncounter).toHaveBeenCalledWith(ENCOUNTER);
    expect(closed.status).toBe('CLOSED');
  });

  it('is idempotent on an already-closed note', async () => {
    vi.mocked(findEncounterById).mockResolvedValue(encounter(0));

    await service.close(ENCOUNTER, professional);
    expect(closeEncounter).not.toHaveBeenCalled();
  });
});

describe('update', () => {
  it('refuses to edit a closed note', async () => {
    vi.mocked(findEncounterById).mockResolvedValue(encounter(0));

    await expect(
      service.update(ENCOUNTER, { content: 'baru' }, professional),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('replaces entries rather than appending them', async () => {
    // A retried request must not duplicate every line of the record.
    await service.update(
      ENCOUNTER,
      { entries: [{ type: 'note', title: 'Revisi' }] },
      professional,
    );

    expect(vi.mocked(replaceEncounterHistory).mock.calls[0][0].entries).toEqual([
      { type: 'note', title: 'Revisi' },
    ]);
  });
});
