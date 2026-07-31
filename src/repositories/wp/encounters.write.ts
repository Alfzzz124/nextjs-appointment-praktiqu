/**
 * Encounter writes — via the praktiqu-endpoint plugin, never direct SQL.
 *
 * An encounter is KiviCare's clinical record of one session. Reads stay in
 * `src/services/billing/encounter.service.ts`, which queries the table directly.
 * Writes must not: `kc_encounter_save` and `kc_encounter_update` carry KiviCare's own
 * bookkeeping, and closing an encounter fires `kc_encounter_closed`, which mails the
 * patient their notes and prescription.
 *
 * That last hook is worth a note. KiviCare registers a listener for it
 * (`KCEncounterNotificationListener`) but **never fires it anywhere in core or Pro** —
 * the listener has been waiting for an action nobody triggers. The plugin route fires
 * it on close with the payload that listener reads, so the notification works for
 * encounters we close. KiviCare's own UI still will not send it; that is its bug, not
 * something we can fix from here.
 *
 * See docs/architecture/encounter-migration-plan.md §5.
 */
import { WpEndpointError, wpRequestJson } from '@/lib/wp-endpoint';

/** KiviCare encounter status. 1 = open, 0 = closed. */
export const ENCOUNTER_STATUS = {
  CLOSED: 0,
  OPEN: 1,
} as const;

export type EncounterStatus = (typeof ENCOUNTER_STATUS)[keyof typeof ENCOUNTER_STATUS];

export type CreateEncounterInput = {
  clinicId: number;
  doctorId: number;
  patientId: number;
  /** The appointment this encounter records. Without it, closing cannot notify. */
  appointmentId?: number;
  /** `YYYY-MM-DD`. Defaults to today on the server. */
  encounterDate?: string;
  description?: string;
  status?: EncounterStatus;
  templateId?: number;
  /**
   * WordPress user id credited as the author.
   *
   * A service-token request has no logged-in user, so `get_current_user_id()` on the
   * server would record 0 and lose the clinician. The plugin falls back to the doctor
   * when this is absent.
   */
  addedBy?: number;
};

export type CreatedEncounter = {
  id: number;
  clinicId: number;
  doctorId: number;
  patientId: number;
  appointmentId: number;
  status: number;
};

type CreateResponse = {
  id: number;
  clinic_id: number;
  doctor_id: number;
  patient_id: number;
  appointment_id: number;
  status: number;
};

export async function createEncounter(input: CreateEncounterInput): Promise<CreatedEncounter> {
  const res = await wpRequestJson<CreateResponse>('/encounters', {
    method: 'POST',
    body: {
      clinic_id: input.clinicId,
      doctor_id: input.doctorId,
      patient_id: input.patientId,
      appointment_id: input.appointmentId,
      encounter_date: input.encounterDate,
      description: input.description,
      status: input.status,
      template_id: input.templateId,
      added_by: input.addedBy,
    },
  });

  if (typeof res?.id !== 'number' || !Number.isFinite(res.id)) {
    throw new WpEndpointError('Encounter create returned no id', 502);
  }

  return {
    id: res.id,
    clinicId: res.clinic_id,
    doctorId: res.doctor_id,
    patientId: res.patient_id,
    appointmentId: res.appointment_id,
    status: res.status,
  };
}

export type UpdateEncounterInput = {
  description?: string;
  /** `YYYY-MM-DD`. */
  encounterDate?: string;
};

export async function updateEncounter(
  encounterId: number,
  input: UpdateEncounterInput,
): Promise<{ id: number; updated: string[] }> {
  return wpRequestJson(`/encounters/${encounterId}`, {
    method: 'PUT',
    body: {
      description: input.description,
      encounter_date: input.encounterDate,
    },
  });
}

/**
 * Open or close an encounter.
 *
 * `notified` reports whether the close notification actually went out. It is false for
 * an encounter with no appointment — the listener resolves the patient through the
 * appointment, so there is nobody to mail.
 */
export async function setEncounterStatus(
  encounterId: number,
  status: EncounterStatus,
): Promise<{ id: number; status: number; closed: boolean; notified: boolean }> {
  return wpRequestJson(`/encounters/${encounterId}/status`, {
    method: 'POST',
    body: { status },
  });
}

/** Close an encounter, sending the patient their notes and prescription. */
export async function closeEncounter(encounterId: number) {
  return setEncounterStatus(encounterId, ENCOUNTER_STATUS.CLOSED);
}

/* ------------------------------------------------------------------ */
/* Children                                                            */
/* ------------------------------------------------------------------ */

/** KiviCare's medical-history vocabulary — what replaced our SOAP sections. */
export const HISTORY_TYPE = {
  PROBLEM: 'problem',
  OBSERVATION: 'observation',
  NOTE: 'note',
} as const;

export type HistoryType = (typeof HISTORY_TYPE)[keyof typeof HISTORY_TYPE];

export type HistoryEntry = {
  type: HistoryType;
  title: string;
};

/**
 * Replace the encounter's medical history entries.
 *
 * Replace, not append: editing a note rewrites its entries wholesale, and a retried
 * write must not duplicate them. Entries with an empty title are dropped server-side —
 * they would render as blank rows in KiviCare's encounter view.
 */
export async function replaceEncounterHistory(opts: {
  encounterId: number;
  patientId: number;
  entries: HistoryEntry[];
  addedBy: number;
}): Promise<{ encounter_id: number; entries: number }> {
  return wpRequestJson(`/encounters/${opts.encounterId}/history`, {
    method: 'PUT',
    body: {
      patient_id: opts.patientId,
      added_by: opts.addedBy,
      entries: opts.entries,
    },
  });
}

export type PrescriptionItem = {
  name: string;
  frequency?: string;
  duration?: string;
  instruction?: string;
};

/**
 * Replace the encounter's prescriptions.
 *
 * `frequency` and `duration` are varchar(199) in KiviCare's schema and are truncated
 * server-side rather than rejected.
 */
export async function replaceEncounterPrescriptions(opts: {
  encounterId: number;
  patientId: number;
  items: PrescriptionItem[];
  addedBy: number;
}): Promise<{ encounter_id: number; ids: number[] }> {
  return wpRequestJson(`/encounters/${opts.encounterId}/prescriptions`, {
    method: 'PUT',
    body: {
      patient_id: opts.patientId,
      added_by: opts.addedBy,
      items: opts.items,
    },
  });
}
