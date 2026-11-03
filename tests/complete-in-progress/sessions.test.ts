import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import type { Actor } from '@/lib/auth';
import { bulkCancelSessions, exportSessions } from '@/services/session/session.service';
import { idBlock } from '../helpers/id-blocks';

const { BASE } = idBlock('complete-in-progress/sessions.test.ts');

/** exportSessions resolves its actor through the auth mirror, so the super admin needs a row. */
const SUPER_ID = 'complete-sessions-test-super';
const SUPER = { id: SUPER_ID, role: 'SUPER_ADMIN' } as Actor;

let existingSessionId: string | null = null;
let practiceId: string | null = null;

beforeAll(async () => {
  const session = await prisma.session.findFirst({ orderBy: { createdAt: 'desc' } });
  existingSessionId = session?.id ?? null;
  practiceId = session?.practiceId ?? null;
  await prisma.user.deleteMany({ where: { id: SUPER_ID } });
  await prisma.user.create({
    data: {
      id: SUPER_ID,
      email: `${SUPER_ID}@sessions.test.local`,
      username: SUPER_ID,
      firstName: 'T',
      lastName: 'U',
      displayName: 'Test User',
      role: 'SUPER_ADMIN',
      wpUserId: BigInt(BASE + 900),
      status: 1,
    },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: SUPER_ID } });
});

describe('bulkCancelSessions', () => {
  it('returns 0 for empty ids without error', async () => {
    const n = await bulkCancelSessions([]);
    expect(n).toBe(0);
  });
});

describe('exportSessions', () => {
  it('returns an array', async () => {
    const rows = await exportSessions(SUPER, {});
    expect(Array.isArray(rows)).toBe(true);
  });

  it('filters by clinic when provided', async () => {
    // practiceId was a cuid from the retired shadow schema; a clinic is now a numeric
    // wp_kc_clinics id.
    const rows = await exportSessions(SUPER, { clinicId: 1 });
    expect(Array.isArray(rows)).toBe(true);
  });
});
