// src/services/progress/service.ts
import type { PrismaClient } from '@prisma/client';

export interface ProgressEntry {
  id: string;
  clientId: string;
  type: string;
  title: string;
  description?: string | null;
  occurredAt: Date;
}

export class ProgressService {
  constructor(private prisma: PrismaClient) {}

  async getClientTimeline(clientId: string, limit = 50) {
    const [sessions, notes, plans] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { patientId: clientId },
        orderBy: { appointmentStartDate: 'desc' },
        take: limit,
        include: { doctor: { include: { user: true } }, services: true },
      }),
      this.prisma.sessionNote.findMany({
        where: { /* sessionId in sessions */ },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.interventionPlan.findMany({
        where: { clientId },
        orderBy: { createdAt: 'desc' },
        include: { items: true },
        take: limit,
      }),
    ]);

    const entries: ProgressEntry[] = [];

    for (const appt of sessions) {
      entries.push({
        id: appt.id,
        clientId,
        type: 'session',
        title: `Session: ${appt.status}`,
        description: appt.description ?? undefined,
        occurredAt: appt.appointmentStartDate,
      });
    }

    return entries.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  }

  async getGoals(clientId: string) {
    return this.prisma.goal.findMany({
      where: { clientId },
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