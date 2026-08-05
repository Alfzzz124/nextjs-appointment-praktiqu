/**
 * ProgressService — the session timeline now reads KiviCare's appointments.
 *
 * Goals stay on our own table, so those still go through the injected client.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/repositories/wp/sessions.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/sessions.repo')>()),
  listSessions: vi.fn(),
}));

import { ProgressService } from '@/services/progress/service';
import { listSessions } from '@/repositories/wp/sessions.repo';

const CLIENT = 461;

const goal = {
  findMany: vi.fn(),
  update: vi.fn(),
};

describe('ProgressService', () => {
  let svc: ProgressService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listSessions).mockResolvedValue({ items: [], total: 0 });
    goal.findMany.mockResolvedValue([]);
    goal.update.mockResolvedValue({ id: 'g1', isAchieved: true });
    svc = new ProgressService({ goal } as never);
  });

  it('gets an empty timeline for a new client', async () => {
    expect(await svc.getClientTimeline(CLIENT)).toEqual([]);
  });

  it('scopes the timeline to the client', async () => {
    await svc.getClientTimeline(CLIENT, 10);
    expect(vi.mocked(listSessions).mock.calls[0][0]).toMatchObject({
      clientId: CLIENT,
      perPage: 10,
    });
  });

  it('gets goals for a client', async () => {
    await svc.getGoals(CLIENT);
    // goals.clientId is a String column with no FK, so the id goes in as text.
    expect(goal.findMany.mock.calls[0][0].where).toEqual({ clientId: String(CLIENT) });
  });

  it('marks a goal achieved', async () => {
    const result = await svc.markGoalAchieved('g1');
    expect(goal.update).toHaveBeenCalledWith({
      where: { id: 'g1' },
      data: expect.objectContaining({ isAchieved: true, achievedAt: expect.any(Date) }),
    });
    expect(result.isAchieved).toBe(true);
  });
});
