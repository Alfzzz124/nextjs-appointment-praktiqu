// A professional's Google Calendar connection: storing it, reading it back, and
// reporting its state honestly.
//
// Read-only and one-way. The granted scope is `calendar.freebusy`, which returns
// opaque busy intervals and no event content — a psychologist's personal calendar
// plausibly holds other clients' names, and this is a health application.

import { prisma } from '@/lib/prisma';
import { encryptSecret, decryptSecret, SecretKeyError } from '@/lib/secret-box';

/** The connection exists but cannot be used right now. */
export class ConnectionUnusableError extends Error {
  readonly code = 'CONNECTION_UNUSABLE';
}

/**
 * How a connection's state may be changed.
 *
 * A discriminated union rather than a status string plus an optional message, so
 * `error` without a message is not expressible. The front end asked for exactly
 * this: "something went wrong" with no detail leaves neither the professional nor
 * practice staff a next step, and a runtime check would only catch it in
 * production.
 */
export type ConnectionMark =
  | { status: 'active' }
  /** Not an error. While the Google app is in Testing this happens every 7 days. */
  | { status: 'revoked' }
  | { status: 'error'; message: string };

export interface ConnectionStatusView {
  status: 'not_connected' | 'active' | 'revoked' | 'error';
  googleAccountEmail: string | null;
  calendarIds: string[];
  connectedAt: string | null;
  lastCheckedAt: string | null;
  lastErrorMessage: string | null;
}

/**
 * Calendars Google generates rather than the person creating them.
 *
 * Excluded server-side, not merely left unticked in a picker: their entries are
 * all-day, so `freebusy` reports them as busy for the whole day, and one "Budi's
 * birthday" would erase every bookable slot. A picker only protects the people who
 * go through the picker.
 */
function isGoogleGeneratedCalendar(id: string): boolean {
  return (
    id.includes('#holiday@group.v.calendar.google.com') ||
    id.includes('#contacts@group.v.calendar.google.com') ||
    id.includes('#weeknum@group.v.calendar.google.com')
  );
}

export function usableCalendarIds(ids: readonly string[]): string[] {
  const kept = ids.filter((id) => !isGoogleGeneratedCalendar(id));
  return kept.length > 0 ? kept : ['primary'];
}

function encryptionKey(): string | undefined {
  return process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
}

export async function saveConnection(input: {
  professionalId: number;
  googleAccountEmail: string;
  refreshToken: string;
  scopeGranted: string;
  calendarIds?: readonly string[];
}) {
  const calendarIds = usableCalendarIds(input.calendarIds ?? ['primary']);
  const encrypted = encryptSecret(input.refreshToken, encryptionKey());
  const now = new Date();

  // Upsert on professionalId: reconnecting after a revocation reuses the row, so
  // the settings page keeps one entry rather than sprouting a new one each week.
  const data = {
    googleAccountEmail: input.googleAccountEmail,
    refreshTokenEncrypted: encrypted,
    scopeGranted: input.scopeGranted,
    calendarIds,
    status: 'active',
    connectedAt: now,
    lastErrorAt: null,
    lastErrorMessage: null,
  };

  return prisma.googleCalendarConnection.upsert({
    where: { professionalId: BigInt(input.professionalId) },
    create: { professionalId: BigInt(input.professionalId), ...data },
    update: data,
  });
}

export async function markConnection(
  professionalId: number,
  mark: ConnectionMark,
): Promise<void> {
  const now = new Date();
  const patch =
    mark.status === 'error'
      ? { status: 'error', lastErrorAt: now, lastErrorMessage: mark.message }
      : mark.status === 'revoked'
        ? // The credential is dead; keeping it only widens what a leak would expose.
          // The row stays so the person can see it and reconnect.
          {
            status: 'revoked',
            refreshTokenEncrypted: null,
            lastErrorAt: null,
            lastErrorMessage: null,
          }
        : { status: 'active', lastErrorAt: null, lastErrorMessage: null };

  await prisma.googleCalendarConnection.updateMany({
    where: { professionalId: BigInt(professionalId) },
    data: patch,
  });
}

export async function getConnectionStatus(
  professionalId: number,
): Promise<ConnectionStatusView> {
  const row = await prisma.googleCalendarConnection.findUnique({
    where: { professionalId: BigInt(professionalId) },
  });

  if (!row) {
    return {
      status: 'not_connected',
      googleAccountEmail: null,
      calendarIds: [],
      connectedAt: null,
      lastCheckedAt: null,
      lastErrorMessage: null,
    };
  }

  const view: ConnectionStatusView = {
    status: row.status as ConnectionStatusView['status'],
    googleAccountEmail: row.googleAccountEmail,
    calendarIds: Array.isArray(row.calendarIds) ? (row.calendarIds as string[]) : [],
    connectedAt: row.connectedAt.toISOString(),
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastErrorMessage: row.lastErrorMessage,
  };

  // A stored credential we can no longer read is reported as an error, loudly.
  // Left to fall through, it would present as a healthy connection that silently
  // blocks nothing — indistinguishable from never having connected, and a rotated
  // key would take the whole feature down without a single complaint.
  if (row.status === 'active' && row.refreshTokenEncrypted) {
    try {
      decryptSecret(row.refreshTokenEncrypted, encryptionKey());
    } catch (err) {
      const ours = err instanceof SecretKeyError;
      console.error('[google-calendar] stored credential unreadable', {
        professionalId,
        reason: ours ? 'encryption key invalid or rotated' : 'stored value corrupt',
      });
      return {
        ...view,
        status: 'error',
        lastErrorMessage: ours
          ? 'The server cannot read stored calendar credentials. Contact support.'
          : 'This calendar connection is damaged. Please reconnect.',
      };
    }
  }

  return view;
}

/** The refresh token, or a refusal saying why it cannot be had. */
export async function getRefreshToken(professionalId: number): Promise<string> {
  const row = await prisma.googleCalendarConnection.findUnique({
    where: { professionalId: BigInt(professionalId) },
  });
  if (!row) throw new ConnectionUnusableError('No Google Calendar connection');
  if (row.status !== 'active' || !row.refreshTokenEncrypted) {
    throw new ConnectionUnusableError(`Connection is ${row.status}`);
  }
  return decryptSecret(row.refreshTokenEncrypted, encryptionKey());
}

export async function disconnectCalendar(professionalId: number): Promise<void> {
  await prisma.googleCalendarConnection.deleteMany({
    where: { professionalId: BigInt(professionalId) },
  });
}
