/**
 * Client progress — the session timeline reads KiviCare's appointments.
 *
 * Goals and milestones stay in our own tables: they are PraktiQU concepts with no
 * KiviCare equivalent. Only the session half moved off the `appointments` shadow
 * table. See docs/architecture/shadow-tables-audit.md.
 *
 * `clientId` is a `wp_users.ID`. `goals.clientId` is a free-form String column with no
 * foreign key, so it holds that id as text.
 */
import type { PrismaClient } from '@prisma/client';
import { listSessions } from '@/repositories/wp/sessions.repo';

export interface ProgressEntry {
  id: number;
  clientId: number;
  type: string;
  title: string;
  description?: string | null;
  occurredAt: Date;
}

export class ProgressService {
  constructor(private prisma: PrismaClient) {}

  /**
   * The client's sessions, newest first.
   *
   * Sessions only, as before. The previous version also queried `sessionNote` with an
   * empty `where` — a full-table scan whose result was never read — and intervention
   * plans it likewise discarded. Both are dropped rather than left running; folding
   * them into the timeline is a separate change.
   */
  async getClientTimeline(clientId: number, limit = 50): Promise<ProgressEntry[]> {
    const { items } = await listSessions({ page: 1, perPage: limit, clientId });

    const entries: ProgressEntry[] = items.map((s) => ({
      id: s.id,
      clientId,
      type: 'session',
      title: `Session: ${s.status}`,
      description: s.description ?? undefined,
      // slotDate is the local clinic date; a row without one cannot be placed on a
      // timeline, so it falls back to when the appointment was created.
      occurredAt: s.slotDate ? new Date(`${s.slotDate}T00:00:00Z`) : s.createdAt,
    }));

    return entries.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  }

  async getGoals(clientId: number) {
    return this.prisma.goal.findMany({
      where: { clientId: String(clientId) },
      orderBy: { createdAt: 'desc' },
      include: { milestones: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async markGoalAchieved(goalId: string) {
    return this.prisma.goal.update({
      where: { id: goalId },
      data: { isAchieved: true, achievedAt: new Date() },
    });
  }
}
