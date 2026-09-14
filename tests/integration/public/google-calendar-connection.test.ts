/**
 * Storing and reading a professional's Google Calendar connection.
 *
 * Against the real test database: what is being checked is largely what is
 * actually written to the row — that the refresh token is never there in the
 * clear, and that a row which cannot be decrypted surfaces as an error rather
 * than as "nobody connected".
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { assertTestDb } from '../../billing/fixtures';
import {
  saveConnection,
  getConnectionStatus,
  getRefreshToken,
  markConnection,
  disconnectCalendar,
  ConnectionUnusableError,
} from '@/services/integrations/google-calendar-connection.service';

const PRO = 900001;
const TOKEN = '1//0gRefreshTokenExample';

async function wipe() {
  assertTestDb();
  await prisma.googleCalendarConnection.deleteMany({ where: { professionalId: BigInt(PRO) } });
}
beforeEach(wipe);
afterAll(wipe);

async function connect(email = 'dr@gmail.com') {
  return saveConnection({
    professionalId: PRO,
    googleAccountEmail: email,
    refreshToken: TOKEN,
    scopeGranted: 'https://www.googleapis.com/auth/calendar.freebusy',
  });
}

describe('saveConnection', () => {
  it('never writes the refresh token in the clear', async () => {
    await connect();
    const row = await prisma.googleCalendarConnection.findUnique({
      where: { professionalId: BigInt(PRO) },
    });
    expect(row?.refreshTokenEncrypted).toBeTruthy();
    expect(row?.refreshTokenEncrypted).not.toContain(TOKEN);
    expect(row?.refreshTokenEncrypted?.startsWith('v1:')).toBe(true);
  });

  it('reads the token back', async () => {
    await connect();
    expect(await getRefreshToken(PRO)).toBe(TOKEN);
  });

  it('defaults to the primary calendar only', async () => {
    await connect();
    expect((await getConnectionStatus(PRO)).calendarIds).toEqual(['primary']);
  });

  it("drops Google's own holiday and birthday calendars", async () => {
    // Server-side, not merely unticked in a picker: all-day entries there would
    // erase a whole day of slots, and a picker only protects whoever uses it.
    await saveConnection({
      professionalId: PRO,
      googleAccountEmail: 'dr@gmail.com',
      refreshToken: TOKEN,
      scopeGranted: 'scope',
      calendarIds: [
        'primary',
        'en.indonesian#holiday@group.v.calendar.google.com',
        'addressbook#contacts@group.v.calendar.google.com',
        'work@group.calendar.google.com',
      ],
    });
    expect((await getConnectionStatus(PRO)).calendarIds).toEqual([
      'primary',
      'work@group.calendar.google.com',
    ]);
  });

  it('reuses the row on reconnect and moves connectedAt forward', async () => {
    const first = await connect();
    await markConnection(PRO, { status: 'revoked' });
    await new Promise((r) => setTimeout(r, 5));
    const again = await connect('other@gmail.com');

    expect(again.id).toBe(first.id);
    expect(again.connectedAt.getTime()).toBeGreaterThan(first.connectedAt.getTime());
    const view = await getConnectionStatus(PRO);
    expect(view.status).toBe('active');
    expect(view.googleAccountEmail).toBe('other@gmail.com');
  });
});

describe('getConnectionStatus', () => {
  it('reports not_connected for a professional who never connected', async () => {
    const view = await getConnectionStatus(PRO);
    expect(view.status).toBe('not_connected');
    expect(view.connectedAt).toBeNull();
  });

  it('carries connectedAt once connected', async () => {
    await connect();
    expect((await getConnectionStatus(PRO)).connectedAt).not.toBeNull();
  });

  it('reports revoked without an error message', async () => {
    await connect();
    await markConnection(PRO, { status: 'revoked' });
    const view = await getConnectionStatus(PRO);
    expect(view.status).toBe('revoked');
    expect(view.lastErrorMessage).toBeNull();
  });

  it('always carries a message when the status is error', async () => {
    await connect();
    await markConnection(PRO, { status: 'error', message: 'Google refused the token' });
    const view = await getConnectionStatus(PRO);
    expect(view.status).toBe('error');
    expect(view.lastErrorMessage).toBe('Google refused the token');
  });

  it('reports a row it cannot decrypt as error, never as not_connected', async () => {
    // The failure this guards against: a rotated key makes every connection
    // unreadable, and if that reads as "nobody connected" the whole feature goes
    // silently dead with every slot still on offer.
    await connect();
    await prisma.googleCalendarConnection.update({
      where: { professionalId: BigInt(PRO) },
      data: { refreshTokenEncrypted: 'v1:bm90LWEtcmVhbC1jaXBoZXJ0ZXh0' },
    });
    // The service logs this, which is the point — silenced so the run stays
    // readable, and asserted so silencing it cannot hide the log disappearing.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const view = await getConnectionStatus(PRO);
      expect(view.status).toBe('error');
      expect(view.lastErrorMessage).toBeTruthy();
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});

describe('token access', () => {
  it('refuses to hand out a token for a revoked connection', async () => {
    await connect();
    await markConnection(PRO, { status: 'revoked' });
    await expect(getRefreshToken(PRO)).rejects.toBeInstanceOf(ConnectionUnusableError);
  });

  it('clears the stored credential when revoked', async () => {
    await connect();
    await markConnection(PRO, { status: 'revoked' });
    const row = await prisma.googleCalendarConnection.findUnique({
      where: { professionalId: BigInt(PRO) },
    });
    expect(row?.refreshTokenEncrypted).toBeNull();
  });
});

describe('disconnectCalendar', () => {
  it('removes the connection entirely', async () => {
    await connect();
    await disconnectCalendar(PRO);
    expect((await getConnectionStatus(PRO)).status).toBe('not_connected');
  });
});
