// tests/integration/progress/timeline.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProgressService } from '@/services/progress/service';

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    appointment = { findMany: vi.fn().mockResolvedValue([]) };
    sessionNote = { findMany: vi.fn().mockResolvedValue([]) };
    interventionPlan = { findMany: vi.fn().mockResolvedValue([]) };
    goal = { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() };
  },
}));

describe('ProgressService integration', () => {
  let svc: ProgressService;

  beforeEach(() => {
    svc = new ProgressService({
      appointment: { findMany: vi.fn().mockResolvedValue([
        { id: 'a1', patientId: 'c1', appointmentStartDate: new Date('2026-01-15'), status: 'CHECK_IN' },
      ]) },
      sessionNote: { findMany: vi.fn().mockResolvedValue([]) },
      interventionPlan: { findMany: vi.fn().mockResolvedValue([]) },
      goal: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    } as any);
  });

  it('assembles sessions into timeline entries', async () => {
    const timeline = await svc.getClientTimeline('c1');
    expect(timeline.length).toBe(1);
    expect(timeline[0].type).toBe('session');
    expect(timeline[0].clientId).toBe('c1');
  });

  it('sorts by date descending', async () => {
    const svc2 = new ProgressService({
      appointment: { findMany: vi.fn().mockResolvedValue([
        { id: 'a1', patientId: 'c1', appointmentStartDate: new Date('2026-01-01'), status: 'CHECK_IN' },
        { id: 'a2', patientId: 'c1', appointmentStartDate: new Date('2026-03-01'), status: 'CHECK_IN' },
      ]) },
      sessionNote: { findMany: vi.fn().mockResolvedValue([]) },
      interventionPlan: { findMany: vi.fn().mockResolvedValue([]) },
      goal: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    } as any);
    const timeline = await svc2.getClientTimeline('c1');
    expect(timeline[0].id).toBe('a2'); // March before January
  });
});