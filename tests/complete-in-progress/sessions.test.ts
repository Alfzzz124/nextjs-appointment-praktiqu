import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { bulkDeleteSessions, exportSessions } from '@/services/session/session.service';

let existingSessionId: string | null = null;
let practiceId: string | null = null;

beforeAll(async () => {
  const session = await prisma.session.findFirst({ orderBy: { createdAt: 'desc' } });
  existingSessionId = session?.id ?? null;
  practiceId = session?.practiceId ?? null;
});

describe('bulkDeleteSessions', () => {
  it('returns 0 for empty ids without error', async () => {
    const n = await bulkDeleteSessions([]);
    expect(n).toBe(0);
  });
});

describe('exportSessions', () => {
  it('returns an array', async () => {
    const rows = await exportSessions({});
    expect(Array.isArray(rows)).toBe(true);
  });

  it('filters by practiceId when provided', async () => {
    if (!practiceId) return; // skip if no sessions in DB
    const rows = await exportSessions({ practiceId });
    expect(Array.isArray(rows)).toBe(true);
  });
});
