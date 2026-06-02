// tests/unit/progress/service.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProgressService } from '@/services/progress/service';

function makePrisma() {
  return {
    appointment: { findMany: vi.fn().mockResolvedValue([]) },
    sessionNote: { findMany: vi.fn().mockResolvedValue([]) },
    interventionPlan: { findMany: vi.fn().mockResolvedValue([]) },
    goal: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({ id: 'g1', isAchieved: true }) },
  } as any;
}

describe('ProgressService', () => {
  let svc: ProgressService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => { prisma = makePrisma(); svc = new ProgressService(prisma); });

  it('gets empty timeline for new client', async () => {
    const timeline = await svc.getClientTimeline('new-client');
    expect(Array.isArray(timeline)).toBe(true);
    expect(timeline).toHaveLength(0);
  });

  it('gets goals for client', async () => {
    await svc.getGoals('c1');
    expect(prisma.goal.findMany).toHaveBeenCalled();
  });

  it('marks goal achieved', async () => {
    const result = await svc.markGoalAchieved('g1');
    expect(prisma.goal.update).toHaveBeenCalledWith({
      where: { id: 'g1' },
      data: expect.objectContaining({ isAchieved: true, achievedAt: expect.any(Date) }),
    });
    expect(result.isAchieved).toBe(true);
  });
});