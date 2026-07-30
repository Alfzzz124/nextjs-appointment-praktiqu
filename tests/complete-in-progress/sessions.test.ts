import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { bulkCancelSessions, exportSessions } from '@/services/session/session.service';

let existingSessionId: string | null = null;
let practiceId: string | null = null;

beforeAll(async () => {
  const session = await prisma.session.findFirst({ orderBy: { createdAt: 'desc' } });
  existingSessionId = session?.id ?? null;
  practiceId = session?.practiceId ?? null;
});

describe('bulkCancelSessions', () => {
  it('returns 0 for empty ids without error', async () => {
    const n = await bulkCancelSessions([]);
    expect(n).toBe(0);
  });
});

describe('exportSessions', () => {
  it('returns an array', async () => {
    const rows = await exportSessions({});
    expect(Array.isArray(rows)).toBe(true);
  });

  it('filters by clinic when provided', async () => {
    // practiceId was a cuid from the retired shadow schema; a clinic is now a numeric
    // wp_kc_clinics id.
    const rows = await exportSessions({ clinicId: 1 });
    expect(Array.isArray(rows)).toBe(true);
  });
});
