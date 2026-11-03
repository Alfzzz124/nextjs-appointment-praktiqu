// Getting appointments into Google Calendar, and keeping them there.
//
// Two layers. Appointment writes only RECORD what should be true; a periodic sweep
// is the only thing that talks to Google. Google being slow must not slow down the
// person booking, and Google being down must not fail a booking at all.
//
// The second layer is reconciliation, and it exists because of this project's own
// history: WordPress Action Scheduler died silently twice — once on an argument
// schema, once on leaked claims — and nobody noticed for months. A queue that only
// fires and forgets loses work without a trace. A sweep that re-derives what should
// be true heals itself after any outage.

import { prisma } from '@/lib/prisma';
import { googleOAuthConfig, GoogleConfigError } from '@/lib/google/config';
import { grantsWriteScope } from '@/lib/google/oauth-client';
import { refreshAccessToken, GoogleAuthRevokedError } from '@/lib/google/freebusy';
import {
  createEvent,
  updateEvent,
  deleteEvent,
  createAppCalendar,
  GoogleEventGoneError,
  GoogleEventNotOursError,
} from '@/lib/google/events';
import {
  buildEventBody,
  fingerprintEvent,
  desiredStateFor,
  ABSENT_FINGERPRINT,
} from '@/services/integrations/google-event-payload';
import {
  loadAppointmentsForCalendar,
  type AppointmentLoader,
} from '@/services/integrations/appointment-calendar-loader';
import { findAppointmentById } from '@/repositories/wp/appointments.repo';
import {
  markConnection,
  getRefreshToken,
  getOrCreateAppCalendarId,
} from '@/services/integrations/google-calendar-connection.service';
import { CLINIC_TIME_ZONE } from '@/services/integrations/google-event-payload';

/**
 * Marks a row as needing work without computing the event first.
 *
 * Deliberately not a hash: callers on the booking path hold an appointment id and
 * a status, not a client's name and e-mail address, and making them gather all
 * that just to write an intent would put four joins on the booking request. The
 * sweep computes the real fingerprint from live data, which also means an intent
 * recorded from stale details still converges on the truth.
 */
export const DIRTY = 'dirty'.padEnd(64, '-');

const MAX_BACKOFF_MINUTES = 6 * 60;
/** A row we must not touch again soon: the event belongs to someone else. */
const PARKED_MINUTES = 24 * 60;

export interface SweepReport {
  examined: number;
  created: number;
  updated: number;
  deleted: number;
  alreadyCurrent: number;
  failed: number;
  skippedNoWriteScope: number;
}

/**
 * Record what should be true of this appointment in Google. Never throws.
 *
 * Called from appointment write paths, where a failure to record must not take the
 * booking down with it. A lost intent is recovered by the next reconciliation.
 */
export async function recordCalendarIntent(input: {
  appointmentId: number | bigint;
  /** Resolved from the appointment when the caller does not have it. */
  professionalId?: number | bigint;
  /** Likewise. A reschedule knows the times changed but not the status. */
  status?: number;
}): Promise<void> {
  try {
    const appointmentId = BigInt(input.appointmentId);

    let professionalId = input.professionalId;
    let status = input.status;
    if (professionalId === undefined || status === undefined) {
      const appt = await findAppointmentById(appointmentId);
      if (!appt) return;
      professionalId ??= appt.doctorId;
      status ??= appt.status;
    }

    const desiredState = desiredStateFor(status);

    await prisma.googleCalendarEventSync.upsert({
      where: { appointmentId },
      create: {
        appointmentId,
        professionalId: BigInt(professionalId),
        desiredState,
        desiredHash: DIRTY,
        attempts: 0,
        nextAttemptAt: null,
      },
      update: {
        professionalId: BigInt(professionalId),
        desiredState,
        desiredHash: DIRTY,
        // A fresh intent clears the backoff: the previous failure was about the
        // previous intent, and a cancellation should not wait out the retry delay
        // earned by a creation that failed.
        attempts: 0,
        nextAttemptAt: null,
        lastError: null,
      },
    });
  } catch (err) {
    console.error('[google-calendar] could not record calendar intent', {
      appointmentId: String(input.appointmentId),
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

type SyncRow = {
  appointmentId: bigint;
  professionalId: bigint;
  desiredState: string;
  desiredHash: string;
  syncedHash: string | null;
  googleEventId: string | null;
  calendarId: string;
  attempts: number;
};

function backoffFrom(now: Date, attempts: number, minutes?: number): Date {
  const wait = minutes ?? Math.min(2 ** Math.min(attempts, 10), MAX_BACKOFF_MINUTES);
  return new Date(now.getTime() + wait * 60_000);
}

async function markFailed(row: SyncRow, now: Date, message: string, minutes?: number) {
  await prisma.googleCalendarEventSync.update({
    where: { appointmentId: row.appointmentId },
    data: {
      attempts: { increment: 1 },
      nextAttemptAt: backoffFrom(now, row.attempts + 1, minutes),
      lastError: message.slice(0, 500),
    },
  });
}

async function markSynced(
  row: SyncRow,
  hash: string,
  googleEventId: string | null,
  calendarId?: string,
) {
  await prisma.googleCalendarEventSync.update({
    where: { appointmentId: row.appointmentId },
    data: {
      desiredHash: hash,
      syncedHash: hash,
      googleEventId,
      // Recorded with the event, because deleting it later has to go to the
      // calendar it actually lives on, not wherever we would put a new one.
      ...(calendarId ? { calendarId } : {}),
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
    },
  });
}

/**
 * Work through rows that are not in the state they should be.
 *
 * Grouped by professional so one token refresh covers all of that person's events
 * rather than one refresh per appointment.
 */
export async function runEventSweep(opts: {
  now?: Date;
  limit?: number;
  loader?: AppointmentLoader;
  fetchImpl?: typeof fetch;
} = {}): Promise<SweepReport> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 200;
  const loader = opts.loader ?? loadAppointmentsForCalendar;
  const report: SweepReport = {
    examined: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    alreadyCurrent: 0,
    failed: 0,
    skippedNoWriteScope: 0,
  };

  let config: ReturnType<typeof googleOAuthConfig>;
  try {
    config = googleOAuthConfig();
  } catch (err) {
    if (err instanceof GoogleConfigError) return report;
    throw err;
  }

  const rows = (await prisma.googleCalendarEventSync.findMany({
    where: {
      AND: [
        {
          OR: [
            // `syncedHash IS NULL` must be spelled out. A column comparison against
            // NULL evaluates to NULL, not true, so NOT(…) is NULL too and MySQL
            // drops the row — which would silently skip exactly the rows that have
            // never synced once, the ones that most need the sweep.
            { syncedHash: null },
            {
              NOT: {
                desiredHash: { equals: prisma.googleCalendarEventSync.fields.syncedHash },
              },
            },
          ],
        },
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      ],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { updatedAt: 'asc' }],
    take: limit,
  })) as SyncRow[];

  report.examined = rows.length;
  if (rows.length === 0) return report;

  const byProfessional = new Map<string, SyncRow[]>();
  for (const row of rows) {
    const key = row.professionalId.toString();
    const list = byProfessional.get(key);
    if (list) list.push(row);
    else byProfessional.set(key, [row]);
  }

  for (const [professionalKey, professionalRows] of byProfessional) {
    const professionalId = Number(professionalKey);

    const connection = await prisma.googleCalendarConnection.findUnique({
      where: { professionalId: BigInt(professionalKey) },
    });

    // No connection, not active, or the write scope was never granted. Not an
    // error and not worth a retry storm: the read direction may well be working
    // for this person, and writing simply is not switched on.
    if (
      !connection ||
      connection.status !== 'active' ||
      !grantsWriteScope(connection.scopeGranted)
    ) {
      report.skippedNoWriteScope += professionalRows.length;
      continue;
    }

    let accessToken: string;
    try {
      const refreshToken = await getRefreshToken(professionalId);
      accessToken = await refreshAccessToken({ ...config, refreshToken }, opts.fetchImpl);
    } catch (err) {
      if (err instanceof GoogleAuthRevokedError) {
        await markConnection(professionalId, { status: 'revoked' });
      }
      report.failed += professionalRows.length;
      continue;
    }

    // Kalender "PraktiQu" milik orang ini, dibuat sekali. Dengan
    // `calendar.app.created` inilah satu-satunya kalender yang boleh kita
    // sentuh — kalender aslinya tidak terjangkau, bukan sekadar tidak disentuh.
    let targetCalendarId: string;
    try {
      targetCalendarId = await getOrCreateAppCalendarId(professionalId, () =>
        createAppCalendar({
          accessToken,
          timeZone: CLINIC_TIME_ZONE,
          fetchImpl: opts.fetchImpl,
        }),
      );
    } catch (err) {
      if (err instanceof GoogleAuthRevokedError) {
        await markConnection(professionalId, { status: 'revoked' });
      }
      report.failed += professionalRows.length;
      continue;
    }

    const presentIds = professionalRows
      .filter((r) => r.desiredState === 'present')
      .map((r) => Number(r.appointmentId));
    const details = presentIds.length > 0 ? await loader(presentIds) : new Map();

    let authDied = false;
    for (const row of professionalRows) {
      if (authDied) break;
      try {
        const outcome = await syncOne({
          row,
          accessToken,
          targetCalendarId,
          details,
          fetchImpl: opts.fetchImpl,
          now,
        });
        report[outcome] += 1;
      } catch (err) {
        if (err instanceof GoogleAuthRevokedError) {
          await markConnection(professionalId, { status: 'revoked' });
          authDied = true;
          report.failed += 1;
          continue;
        }
        const notOurs = err instanceof GoogleEventNotOursError;
        await markFailed(
          row,
          now,
          err instanceof Error ? err.message : String(err),
          notOurs ? PARKED_MINUTES : undefined,
        );
        report.failed += 1;
      }
    }
  }

  return report;
}

type Outcome = 'created' | 'updated' | 'deleted' | 'alreadyCurrent' | 'failed';

async function syncOne(ctx: {
  row: SyncRow;
  accessToken: string;
  /** The professional's PraktiQu calendar — where new events go. */
  targetCalendarId: string;
  details: Map<number, Parameters<typeof buildEventBody>[0]>;
  fetchImpl?: typeof fetch;
  now: Date;
}): Promise<Outcome> {
  const { row, accessToken, targetCalendarId, details, fetchImpl, now } = ctx;
  // Where the event IS, which is not always where a new one would go: someone who
  // disconnects and reconnects gets a fresh calendar, and rows written before
  // that still point at the old one.
  const call = { accessToken, calendarId: row.calendarId, fetchImpl };
  const marker = String(row.appointmentId);

  if (row.desiredState === 'absent') {
    if (!row.googleEventId) {
      await markSynced(row, ABSENT_FINGERPRINT, null);
      return 'alreadyCurrent';
    }
    try {
      await deleteEvent({ ...call, eventId: row.googleEventId, expectMarker: marker });
    } catch (err) {
      // Already gone is the outcome we wanted.
      if (!(err instanceof GoogleEventGoneError)) throw err;
    }
    await markSynced(row, ABSENT_FINGERPRINT, null);
    return 'deleted';
  }

  const appt = details.get(Number(row.appointmentId));
  if (!appt) {
    // The appointment is gone, or lacks the date and times an event needs. Not
    // treated as "delete it": conflating a missing row with a malformed one would
    // quietly remove real events over a bad `appointment_end_time`.
    await markFailed(row, now, 'appointment details unavailable');
    return 'failed';
  }

  const body = buildEventBody(appt);
  const hash = fingerprintEvent(body);

  // Nothing about the event changed — a status flip between BOOKED and CHECK_IN,
  // say. Costs no request at all.
  if (hash === row.syncedHash && row.googleEventId) {
    await markSynced(row, hash, row.googleEventId);
    return 'alreadyCurrent';
  }

  if (row.googleEventId && row.calendarId === targetCalendarId) {
    try {
      await updateEvent({
        ...call,
        eventId: row.googleEventId,
        body,
        expectMarker: marker,
      });
      await markSynced(row, hash, row.googleEventId);
      return 'updated';
    } catch (err) {
      // The professional deleted it by hand. Recreate rather than give up: the
      // appointment is still real and still belongs on their calendar.
      if (!(err instanceof GoogleEventGoneError)) throw err;
    }
  } else if (row.googleEventId) {
    // The event sits on a calendar we no longer write to. Remove it before
    // making the replacement, or they end up with the same appointment twice —
    // once on a stale PraktiQu calendar and once on the current one.
    try {
      await deleteEvent({ ...call, eventId: row.googleEventId, expectMarker: marker });
    } catch (err) {
      // Already gone, or no longer ours to touch. Either way the replacement is
      // still the right thing to make, and nothing here should block it.
      if (!(err instanceof GoogleEventGoneError) && !(err instanceof GoogleEventNotOursError)) {
        throw err;
      }
    }
  }

  const eventId = await createEvent({
    accessToken,
    calendarId: targetCalendarId,
    fetchImpl,
    body,
  });
  await markSynced(row, hash, eventId, targetCalendarId);
  return 'created';
}

export interface ReconcileReport {
  enqueuedMissing: number;
  flippedToAbsent: number;
}

/**
 * Re-derive what should be true, for appointments inside the horizon.
 *
 * Catches intents that were never recorded (a crash between the appointment write
 * and the intent write) and intents that went stale (an appointment cancelled
 * through a path that does not record one).
 */
export async function reconcileCalendarIntents(opts: {
  now?: Date;
  horizonDays?: number;
} = {}): Promise<ReconcileReport> {
  const now = opts.now ?? new Date();
  const horizonDays = opts.horizonDays ?? 60;
  const report: ReconcileReport = { enqueuedMissing: 0, flippedToAbsent: 0 };

  const connections = await prisma.googleCalendarConnection.findMany({
    where: { status: 'active' },
    select: { professionalId: true, scopeGranted: true },
  });
  const writable = connections.filter((c) => grantsWriteScope(c.scopeGranted));
  if (writable.length === 0) return report;

  const doctorIds = writable.map((c) => c.professionalId);
  const from = startOfUtcDay(now);
  const to = new Date(from.getTime() + horizonDays * 86_400_000);

  const appointments = await prisma.kcAppointment.findMany({
    where: {
      doctorId: { in: doctorIds },
      appointmentStartDate: { gte: from, lte: to },
    },
    select: { id: true, doctorId: true, status: true },
  });
  if (appointments.length === 0) return report;

  const existing = await prisma.googleCalendarEventSync.findMany({
    where: { appointmentId: { in: appointments.map((a) => a.id) } },
    select: { appointmentId: true, desiredState: true },
  });
  const stateById = new Map(existing.map((e) => [e.appointmentId.toString(), e.desiredState]));

  const missing: {
    appointmentId: bigint;
    professionalId: bigint;
    desiredState: string;
    desiredHash: string;
  }[] = [];

  for (const appt of appointments) {
    const wanted = desiredStateFor(appt.status);
    const known = stateById.get(appt.id.toString());

    if (known === undefined) {
      // Only worth a row if there is something to do. An appointment that was
      // cancelled long before this feature existed needs no tombstone.
      if (wanted === 'present') {
        missing.push({
          appointmentId: appt.id,
          professionalId: appt.doctorId,
          desiredState: 'present',
          desiredHash: DIRTY,
        });
      }
      continue;
    }

    if (known !== wanted) {
      await prisma.googleCalendarEventSync.update({
        where: { appointmentId: appt.id },
        data: {
          desiredState: wanted,
          desiredHash: DIRTY,
          attempts: 0,
          nextAttemptAt: null,
          lastError: null,
        },
      });
      if (wanted === 'absent') report.flippedToAbsent += 1;
      else report.enqueuedMissing += 1;
    }
  }

  if (missing.length > 0) {
    const result = await prisma.googleCalendarEventSync.createMany({
      data: missing,
      skipDuplicates: true,
    });
    report.enqueuedMissing += result.count;
  }

  return report;
}

/** `@db.Date` columns round-trip as midnight UTC, so compare against the same. */
function startOfUtcDay(at: Date): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 0, 0, 0, 0),
  );
}
