/**
 * Staf memindah jadwal sesi, di tempat: id janji, pembayaran, tagihan, approval, dan token
 * klien tetap. Menggantikan "batalkan + booking baru" di specs/005-session-mgmt.
 *
 * Validitas slot diputuskan di sini, dengan aturan yang sama dengan `createSession`:
 * bukan hari libur, tidak bentrok. Plugin memindahnya di bawah lock jadwal psikolog dan
 * menolak yang hanya bisa dijamin di sana: slot yang keburu diambil, atau baris yang
 * berubah sejak dibaca. Sesudahnya: pengingat dijadwal ulang dari baris baca ulang, klien
 * dan psikolog diberi email, dan pemindahan diaudit.
 *
 * Source of truth: docs/superpowers/specs/2026-10-21-reschedule-staf-design.md §5
 */
import { randomUUID } from 'node:crypto';
import type { Actor } from '@/lib/auth';
import { logging } from '@/lib/logging';
import { buildUtcDateTime, minutesToTime, timeToMinutes } from '@/lib/time';
import { WpEndpointError } from '@/lib/wp-endpoint';
import { findConflictingAppointments } from '@/repositories/wp/appointments.repo';
import { rescheduleAppointment } from '@/repositories/wp/appointments.write';
import { SESSION_STATUS, findSessionById, toKcStatus, type SessionRow } from '@/repositories/wp/sessions.repo';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { mail, mailFacts } from '@/services/approval/service';
import { sessionStartsAtUtc, syncSessionReminders } from './reminder-schedule';
import { buildClientRescheduledEmail, buildProfessionalRescheduledEmail } from './reschedule-email';
import {
  SessionServiceError,
  assertNotOffDay,
  loadForActor,
  reread,
  type SessionWithRelations,
} from './session.service';

/** Selain mereka, hanya psikolog pemilik sesi. Cakupan klinik sudah dijaga loadForActor. */
const STAFF = new Set(['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST']);
const MOVABLE = new Set<string>([SESSION_STATUS.BOOKED, SESSION_STATUS.PENDING]);

/** Penolakan plugin → jawaban yang sama dengan pemeriksaan di sini. */
const PLUGIN_REFUSALS: Record<string, [code: string, message: string, status: number]> = {
  praktiqu_schedule_conflict: ['slot_taken', 'That slot is no longer available', 409],
  praktiqu_schedule_stale: ['session_changed', 'The session changed since it was loaded. Reload and try again', 409],
  praktiqu_schedule_terminal: ['not_reschedulable', 'Only a booked or pending session can be rescheduled', 409],
  praktiqu_schedule_unchanged: ['same_slot', 'The session is already at that time', 400],
  praktiqu_schedule_unavailable: ['slot_in_past', 'That time has already passed', 422],
  praktiqu_schedule_busy: ['schedule_busy', "The professional's schedule is busy. Try again in a moment", 503],
};

export interface RescheduleArgs {
  actor: Actor;
  sessionId: number;
  /** `YYYY-MM-DD`, tanggal lokal klinik. */
  slotDate: string;
  /** `HH:MM` atau `HH:MM:SS`, jam lokal klinik. */
  startTime: string;
  reason?: string;
  /** Disuntikkan oleh tes. */
  now?: Date;
}

export async function rescheduleSession(args: RescheduleArgs): Promise<SessionWithRelations> {
  const { actor, sessionId } = args;
  const now = args.now ?? new Date();
  const reason = args.reason?.trim() || undefined;

  const kc = await resolveKcActor(actor);
  const row = await loadForActor(kc, sessionId);

  const isOwningProfessional = actor.role === 'PROFESSIONAL' && row.professionalId === Number(kc.wpUserId);
  if (!STAFF.has(actor.role) && !isOwningProfessional) {
    throw new SessionServiceError('forbidden', 'Not authorized to reschedule this session', 403);
  }
  if (!MOVABLE.has(row.status) || !row.slotDate || !row.startTime || !row.endTime) {
    throw new SessionServiceError('not_reschedulable', 'Only a booked or pending session can be rescheduled', 409);
  }
  const previousStartsAtUtc = sessionStartsAtUtc(row);
  if (previousStartsAtUtc && previousStartsAtUtc.getTime() <= now.getTime()) {
    throw new SessionServiceError('session_already_started', 'The session has already started', 409);
  }

  // Durasi tetap durasi lama, seperti di plugin.
  const startTime = `${minutesToTime(timeToMinutes(args.startTime))}:00`;
  const length = timeToMinutes(row.endTime) - timeToMinutes(row.startTime);
  const endMinute = timeToMinutes(startTime) + length;
  if (endMinute > 24 * 60) {
    throw new SessionServiceError('unavailable', 'That time runs past midnight', 400);
  }
  const endTime = `${minutesToTime(endMinute)}:00`;

  if (buildUtcDateTime(args.slotDate, timeToMinutes(startTime), row.timezone).getTime() <= now.getTime()) {
    throw new SessionServiceError('slot_in_past', 'That time has already passed', 422);
  }
  if (args.slotDate === row.slotDate && startTime === row.startTime) {
    throw new SessionServiceError('same_slot', 'The session is already at that time', 400);
  }
  await assertNotOffDay(row.professionalId, row.clinicId, args.slotDate, startTime, endTime);
  const clashes = await findConflictingAppointments({
    doctorId: BigInt(row.professionalId),
    date: args.slotDate,
    startTime,
    endTime,
    excludeAppointmentId: BigInt(row.id),
  });
  if (clashes.length > 0) {
    throw new SessionServiceError('slot_taken', 'That slot is no longer available', 409);
  }

  let moved;
  try {
    moved = await rescheduleAppointment(row.id, {
      startDate: args.slotDate,
      startTime,
      expected: {
        doctorId: row.professionalId,
        clinicId: row.clinicId,
        status: toKcStatus(row.status),
        startDate: row.slotDate,
        startTime: row.startTime,
        endDate: row.slotDate,
        endTime: row.endTime,
      },
      actor: actor.id,
      requestId: randomUUID(),
    });
  } catch (err) {
    const refusal = err instanceof WpEndpointError && err.code ? PLUGIN_REFUSALS[err.code] : undefined;
    if (refusal) throw new SessionServiceError(...refusal);
    throw err;
  }

  const fresh = await findSessionById(row.id);
  if (!fresh) {
    throw new SessionServiceError('readback_failed', 'Session was moved but could not be read back', 502);
  }
  await syncSessionReminders(fresh);
  await notifyMoved(fresh, previousStartsAtUtc, reason, moved.meetingUrl);

  await logging.audit('session.rescheduled', {
    userId: actor.id,
    resource: 'session',
    resourceId: String(row.id),
    action: 'session.rescheduled',
    metadata: {
      from: { date: row.slotDate, startTime: row.startTime },
      to: { date: args.slotDate, startTime },
      reason,
      syncOk: moved.syncOk,
    },
  });

  return reread(actor, row.id);
}

/** Email klien dan psikolog. Gagal dicatat, tidak dilempar: jadwalnya sudah pindah. */
async function notifyMoved(
  row: SessionRow,
  previousStartsAtUtc: Date | null,
  reason: string | undefined,
  meetingUrl: string | null,
): Promise<void> {
  try {
    const facts = await mailFacts(row);
    if (!facts || !previousStartsAtUtc) return;
    const f = { ...facts, previousStartsAtUtc, reason, meetingUrl };
    await mail(row.clientEmail, buildClientRescheduledEmail(f), 'session_rescheduled_client');
    await mail(row.professionalEmail, buildProfessionalRescheduledEmail(f), 'session_rescheduled_professional');
  } catch (err) {
    await logging.error('Failed to mail a rescheduled session', err, {
      resource: 'session',
      resourceId: String(row.id),
    });
  }
}
