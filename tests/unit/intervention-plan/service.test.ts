/**
 * InterventionPlanService — a plan IS a KiviCare encounter (phase E4).
 *
 * The old suite stubbed `prisma.interventionPlan` / `prisma.recommendationItem`, two
 * tables that held 0 rows on staging. The repositories are mocked here instead.
 *
 * Worth pinning: a plan and a session note are two views of the SAME encounter, so
 * creating a plan where a note already exists must reuse the row rather than refuse.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/repositories/wp/sessions.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/sessions.repo')>()),
  findSessionById: vi.fn(),
}));
vi.mock('@/repositories/wp/clinical-records.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/clinical-records.repo')>()),
  findEncounterById: vi.fn(),
  findEncounterByAppointmentId: vi.fn(),
  listEncounterPrescriptions: vi.fn(),
  listEncounters: vi.fn(),
  listPrescriptionsForEncounters: vi.fn(),
  getRecommendationStates: vi.fn(),
  setRecommendationState: vi.fn(),
}));
vi.mock('@/repositories/wp/encounters.write', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/encounters.write')>()),
  createEncounter: vi.fn(),
  replaceEncounterPrescriptions: vi.fn(),
}));
vi.mock('@/lib/logging', () => ({
  logging: { audit: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn(), warn: vi.fn() },
}));

import {
  InterventionPlanError,
  InterventionPlanService,
  type Caller,
} from '@/services/intervention-plan/service';
import { findSessionById } from '@/repositories/wp/sessions.repo';
import {
  findEncounterByAppointmentId,
  findEncounterById,
  getRecommendationStates,
  listEncounterPrescriptions,
  listEncounters,
  listPrescriptionsForEncounters,
  setRecommendationState,
} from '@/repositories/wp/clinical-records.repo';
import {
  createEncounter,
  replaceEncounterPrescriptions,
} from '@/repositories/wp/encounters.write';

const SESSION = 5150;
const PLAN = 91; // = encounter id
const ITEM = 700; // = prescription id
const DOCTOR = 29;
const CLIENT = 461;
const CLINIC = 3;

const professional: Caller = { userId: 'cuid-pro', wpUserId: DOCTOR, role: 'PROFESSIONAL' };
const client: Caller = { userId: 'cuid-cli', wpUserId: CLIENT, role: 'CLIENT' };
const otherClient: Caller = { userId: 'cuid-x', wpUserId: CLIENT + 1, role: 'CLIENT' };
const receptionist: Caller = { userId: 'cuid-rec', wpUserId: 900, role: 'RECEPTIONIST' };
const superAdmin: Caller = { userId: 'cuid-sa', wpUserId: 1, role: 'SUPER_ADMIN' };

function encounter() {
  return {
    id: PLAN,
    clinicId: CLINIC,
    doctorId: DOCTOR,
    patientId: CLIENT,
    appointmentId: SESSION,
    description: null,
    status: 1,
    addedBy: DOCTOR,
    encounterDate: null,
    createdAt: new Date('2026-07-15T00:00:00Z'),
  } as never;
}

function prescription(id = ITEM, duration: string | null = '30') {
  return {
    id,
    encounterId: PLAN,
    patientId: CLIENT,
    name: 'Journaling',
    frequency: '3x seminggu',
    duration,
    instruction: 'Sebelum tidur',
    addedBy: DOCTOR,
    isFromTemplate: false,
    createdAt: new Date('2026-07-15T00:00:00Z'),
  } as never;
}

let service: InterventionPlanService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new InterventionPlanService();
  vi.mocked(findSessionById).mockResolvedValue({
    id: SESSION,
    clinicId: CLINIC,
    professionalId: DOCTOR,
    clientId: CLIENT,
    status: 'CHECK_IN',
  } as never);
  vi.mocked(findEncounterByAppointmentId).mockResolvedValue(null);
  vi.mocked(findEncounterById).mockResolvedValue(encounter());
  vi.mocked(listEncounterPrescriptions).mockResolvedValue([]);
  vi.mocked(getRecommendationStates).mockResolvedValue(new Map());
  vi.mocked(listPrescriptionsForEncounters).mockResolvedValue(new Map());
  vi.mocked(createEncounter).mockResolvedValue({ id: PLAN, status: 1 } as never);
});

describe('createPlan', () => {
  it('creates the encounter for the session', async () => {
    const plan = await service.createPlan(
      { sessionId: String(SESSION), clientId: String(CLIENT) },
      professional,
    );

    expect(plan.id).toBe(PLAN);
    expect(plan.sessionId).toBe(String(SESSION));
    expect(vi.mocked(createEncounter).mock.calls[0][0].appointmentId).toBe(SESSION);
  });

  it('reuses the encounter a session note already created', async () => {
    // A plan and a note are two views of the same row. Refusing here would make the
    // two features mutually exclusive on the same session.
    vi.mocked(findEncounterByAppointmentId).mockResolvedValue(encounter());

    const plan = await service.createPlan(
      { sessionId: String(SESSION), clientId: String(CLIENT) },
      professional,
    );

    expect(plan.id).toBe(PLAN);
    expect(createEncounter).not.toHaveBeenCalled();
  });

  it('409s when recommendations were already recorded', async () => {
    vi.mocked(findEncounterByAppointmentId).mockResolvedValue(encounter());
    vi.mocked(listEncounterPrescriptions).mockResolvedValue([prescription()]);

    await expect(
      service.createPlan({ sessionId: String(SESSION), clientId: String(CLIENT) }, professional),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('forbids clients from creating plans', async () => {
    await expect(
      service.createPlan({ sessionId: String(SESSION), clientId: String(CLIENT) }, client),
    ).rejects.toBeInstanceOf(InterventionPlanError);
  });

  it('404s for an unknown session', async () => {
    vi.mocked(findSessionById).mockResolvedValue(null);
    await expect(
      service.createPlan({ sessionId: String(SESSION), clientId: String(CLIENT) }, professional),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('getPlan', () => {
  beforeEach(() => {
    vi.mocked(listEncounterPrescriptions).mockResolvedValue([prescription()]);
  });

  it('maps a prescription onto a recommendation item', async () => {
    const plan = await service.getPlan(PLAN, professional);

    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].description).toBe('Journaling');
    expect(plan.items[0].frequency).toBe('3x seminggu');
    expect(plan.items[0].durationDays).toBe(30);
    expect(plan.items[0].instructions).toBe('Sebelum tidur');
  });

  it('reads durationDays as null when a clinician typed words', async () => {
    // KiviCare's `duration` is a varchar and holds whatever was typed. Only a plain
    // number round-trips; "2 minggu" must not become a wrong integer.
    vi.mocked(listEncounterPrescriptions).mockResolvedValue([prescription(ITEM, '2 minggu')]);

    const plan = await service.getPlan(PLAN, professional);
    expect(plan.items[0].durationDays).toBeNull();
  });

  it('returns the plan to the owning client', async () => {
    expect((await service.getPlan(PLAN, client)).id).toBe(PLAN);
  });

  it('returns the plan to a receptionist and a super admin', async () => {
    expect((await service.getPlan(PLAN, receptionist)).id).toBe(PLAN);
    expect((await service.getPlan(PLAN, superAdmin)).id).toBe(PLAN);
  });

  it('forbids a different client', async () => {
    await expect(service.getPlan(PLAN, otherClient)).rejects.toMatchObject({ status: 403 });
  });

  it('404s for an unknown plan', async () => {
    vi.mocked(findEncounterById).mockResolvedValue(null);
    await expect(service.getPlan(PLAN, professional)).rejects.toMatchObject({ status: 404 });
  });
});

describe('plan status', () => {
  it('is COMPLETED only when every item is', async () => {
    vi.mocked(listEncounterPrescriptions).mockResolvedValue([
      prescription(700),
      prescription(701),
    ]);
    vi.mocked(getRecommendationStates).mockResolvedValue(
      new Map([
        [700, { status: 'COMPLETED', completedAt: new Date() }],
        [701, { status: 'ACTIVE', completedAt: null }],
      ]) as never,
    );

    expect((await service.getPlan(PLAN, professional)).status).toBe('ACTIVE');
  });

  it('is not COMPLETED when the plan is empty', async () => {
    // Nothing has been finished, because there is nothing in it.
    vi.mocked(listEncounterPrescriptions).mockResolvedValue([]);
    expect((await service.getPlan(PLAN, professional)).status).toBe('ACTIVE');
  });
});

describe('addItem', () => {
  it('resends existing items with the new one appended', async () => {
    // The plugin route replaces the whole set, so a retry must leave the same rows
    // rather than duplicating every recommendation.
    vi.mocked(listEncounterPrescriptions).mockResolvedValue([prescription()]);

    await service.addItem(PLAN, { description: 'Latihan napas' }, professional);

    const sent = vi.mocked(replaceEncounterPrescriptions).mock.calls[0][0];
    expect(sent.items.map((i) => i.name)).toEqual(['Journaling', 'Latihan napas']);
    expect(sent.encounterId).toBe(PLAN);
  });

  it('forbids a client from adding items', async () => {
    await expect(service.addItem(PLAN, { description: 'x' }, client)).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('completeItem', () => {
  beforeEach(() => {
    vi.mocked(listEncounterPrescriptions).mockResolvedValue([prescription()]);
  });

  it('records completion in the custom-field store, not on the prescription', async () => {
    const item = await service.completeItem(PLAN, ITEM, client);

    expect(item.status).toBe('COMPLETED');
    expect(item.completedAt).toBeInstanceOf(Date);
    expect(vi.mocked(setRecommendationState).mock.calls[0][0]).toBe(ITEM);
    // The prescription row itself is never rewritten — KiviCare owns it.
    expect(replaceEncounterPrescriptions).not.toHaveBeenCalled();
  });

  it('is idempotent', async () => {
    vi.mocked(getRecommendationStates).mockResolvedValue(
      new Map([[ITEM, { status: 'COMPLETED', completedAt: new Date('2026-07-20') }]]) as never,
    );

    await service.completeItem(PLAN, ITEM, client);
    expect(setRecommendationState).not.toHaveBeenCalled();
  });

  it('only the owning client may complete', async () => {
    await expect(service.completeItem(PLAN, ITEM, professional)).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.completeItem(PLAN, ITEM, otherClient)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('404s for an item outside the plan', async () => {
    await expect(service.completeItem(PLAN, 99999, client)).rejects.toMatchObject({ status: 404 });
  });
});

describe('listPlans', () => {
  beforeEach(() => {
    vi.mocked(listEncounters).mockResolvedValue({ items: [encounter()], total: 1 } as never);
  });

  it('scopes to the calling professional', async () => {
    await service.listPlans(professional);
    expect(vi.mocked(listEncounters).mock.calls[0][0].doctorId).toBe(DOCTOR);
  });

  it('scopes to the calling client', async () => {
    await service.listPlans(client);
    expect(vi.mocked(listEncounters).mock.calls[0][0].patientId).toBe(CLIENT);
  });

  it('does not scope a super admin', async () => {
    await service.listPlans(superAdmin);
    const q = vi.mocked(listEncounters).mock.calls[0][0];
    expect(q.doctorId).toBeUndefined();
    expect(q.patientId).toBeUndefined();
  });
});
