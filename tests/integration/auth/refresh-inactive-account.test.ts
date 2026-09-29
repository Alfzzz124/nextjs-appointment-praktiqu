/**
 * A deactivated account cannot keep its session alive by refreshing.
 *
 * Deactivation writes WordPress state (`wp_users.user_status`, or the
 * `praktiqu_user_status` meta). `users.status` only followed it at login, and every
 * refresh minted a fresh 7-day token — so a receptionist switched off from the dashboard
 * stayed signed in for as long as their browser kept refreshing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { RefreshTokenStatus, UserRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { issueTokensForUser } from '@/services/auth/service';
import { findWpAccountStatus } from '@/repositories/wp/account-status.repo';

const { POST } = await import('@/app/api/v1/auth/refresh/route');

/** Test-owned range, below billing's unbounded `>= 9_000_000` cleanup. */
const WP_ID = 8_700_001;
const USER_ID = 'refresh-inactive-test-user';

async function setWpStatus(userStatus: number, meta: string | null) {
  await prisma.$executeRawUnsafe(`UPDATE wp_users SET user_status = ? WHERE ID = ?`, userStatus, WP_ID);
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_usermeta WHERE user_id = ? AND meta_key = 'praktiqu_user_status'`,
    WP_ID,
  );
  if (meta !== null) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES (?, 'praktiqu_user_status', ?)`,
      WP_ID,
      meta,
    );
  }
}

async function freshRefreshToken(): Promise<string> {
  await prisma.user.update({ where: { id: USER_ID }, data: { status: 1 } });
  const t = await issueTokensForUser(
    { id: USER_ID, role: UserRole.RECEPTIONIST, email: `${USER_ID}@test.local`, username: USER_ID },
    '203.0.113.1',
    'vitest',
  );
  return t.refreshToken;
}

function post(refreshToken: string) {
  return POST(
    new NextRequest('http://localhost/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }),
  );
}

async function wipe() {
  await prisma.refreshToken.deleteMany({ where: { userId: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_usermeta WHERE user_id = ?`, WP_ID);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_users WHERE ID = ?`, WP_ID);
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_users (ID, user_login, user_pass, user_nicename, user_email, user_url, user_registered, user_activation_key, user_status, display_name)
     VALUES (?, ?, '', ?, ?, '', NOW(), '', 0, 'Resepsionis Uji')`,
    WP_ID,
    USER_ID,
    USER_ID,
    `${USER_ID}@test.local`,
  );
  await prisma.user.create({
    data: {
      id: USER_ID,
      email: `${USER_ID}@test.local`,
      username: USER_ID,
      firstName: 'Resepsionis',
      lastName: 'Uji',
      displayName: 'Resepsionis Uji',
      role: UserRole.RECEPTIONIST,
      wpUserId: BigInt(WP_ID),
      status: 1,
    },
  });
});

beforeEach(async () => {
  await prisma.refreshToken.deleteMany({ where: { userId: USER_ID } });
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('findWpAccountStatus — mirrors the plugin’s resolve_status()', () => {
  it.each([
    [0, null, 'active'],
    [1, null, 'inactive'],
    [0, 'inactive', 'inactive'],
    [0, 'blocked', 'blocked'],
    [1, 'active', 'active'], // the meta wins when it is set
  ] as const)('user_status=%s, meta=%s → %s', async (userStatus, meta, expected) => {
    await setWpStatus(userStatus, meta);
    expect(await findWpAccountStatus(BigInt(WP_ID))).toBe(expected);
  });

  it('reports a deleted WordPress account as missing', async () => {
    expect(await findWpAccountStatus(BigInt(WP_ID + 999))).toBe('missing');
  });
});

describe('POST /auth/refresh — deactivated accounts', () => {
  it('still refreshes an active account', async () => {
    await setWpStatus(0, null);
    const res = await post(await freshRefreshToken());
    expect(res.status).toBe(200);
  });

  it('refuses a receptionist deactivated after they signed in, with 401 inactive', async () => {
    await setWpStatus(0, null);
    const token = await freshRefreshToken();
    // Deactivated from the dashboard while the session is open.
    await setWpStatus(1, null);

    const res = await post(token);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code?: string }).code).toBe('inactive');
  });

  it('revokes every token the account holds and marks the app user inactive', async () => {
    await setWpStatus(0, null);
    const token = await freshRefreshToken();
    await freshRefreshToken(); // a second device
    await setWpStatus(0, 'inactive');

    await post(token);

    const active = await prisma.refreshToken.count({
      where: { userId: USER_ID, status: RefreshTokenStatus.ACTIVE },
    });
    expect(active).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } })).status).toBe(0);
  });
});
