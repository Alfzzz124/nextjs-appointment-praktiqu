import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertTestDb, seedClinicAdmin, seedClinicSchedule, cleanup } from './fixtures';
import {
  createSchedule, getSchedule, listSchedules, updateSchedule, deleteSchedule,
  assertModuleInScope, getUnavailableSchedule, scheduleModule,
} from '@/services/billing/clinic-schedule.service';

const CLINIC = 9_000_001, ADMIN = 9_000_002, OTHER_CLINIC = 9_000_501;

// CLINIC_ADMIN actor scoped to CLINIC — create derives clinicId from kc.clinicId.
const kcAdmin = {
  actor: { id: 'test-admin-9000002', role: 'CLINIC_ADMIN', practiceId: null },
  wpUserId: BigInt(ADMIN),
  clinicId: BigInt(CLINIC),
} as any;

const scopeClinic = { clinicId: BigInt(CLINIC) };
const scopeOtherClinic = { clinicId: BigInt(OTHER_CLINIC) };

describe('clinic-schedule.service', () => {
  // No DB needed for the static module config — assert it directly.
  it('scheduleModule() returns module types + selection modes', () => {
    const m = scheduleModule();
    expect(m.moduleTypes).toEqual(['clinic', 'doctor']);
    expect(m.selectionModes).toEqual(['single', 'range', 'multiple']);
  });

  it('assertModuleInScope rejects a CLINIC_ADMIN targeting another clinic (403)', () => {
    expect(() =>
      assertModuleInScope('clinic', OTHER_CLINIC, kcAdmin),
    ).toThrow();
    // targeting own clinic is allowed
    expect(() => assertModuleInScope('clinic', CLINIC, kcAdmin)).not.toThrow();
  });

  describe('DB-backed lifecycle', () => {
    beforeAll(async () => {
      assertTestDb();
      await cleanup();
      await seedClinicAdmin({ userId: ADMIN, clinicId: CLINIC });
    });
    afterAll(cleanup);

    it('creates, reads, lists, updates, and deletes a clinic-module schedule', async () => {
      const { id } = await createSchedule(
        {
          moduleType: 'clinic', moduleId: CLINIC, selectionMode: 'range',
          startDate: '2026-07-01', endDate: '2026-07-05', timeSpecific: false, status: 1,
        },
        kcAdmin,
      );
      expect(id).toBeGreaterThan(0);

      const got = await getSchedule(id, scopeClinic);
      expect(got.module_type).toBe('clinic');
      expect(got.module_id).toBe(CLINIC);
      expect(got.selection_mode).toBe('range');
      expect(got.start_date).toBe('2026-07-01');

      const list = await listSchedules({ page: 1, perPage: 100 } as any, scopeClinic);
      expect(list.schedules.some((s) => s.id === id)).toBe(true);

      await updateSchedule(id, { selectionMode: 'single', description: 'Updated' }, scopeClinic);
      const updated = await getSchedule(id, scopeClinic);
      expect(updated.selection_mode).toBe('single');
      expect(updated.description).toBe('Updated');

      await deleteSchedule(id, scopeClinic);
      await expect(getSchedule(id, scopeClinic)).rejects.toThrow();
    });

    it('scope isolation: another clinic scope cannot see the schedule', async () => {
      const { id } = await seedClinicSchedule({
        id: 9_000_310, moduleType: 'clinic', moduleId: CLINIC, selectionMode: 'range', status: 1,
      });
      // in-scope sees it
      expect((await getSchedule(id, scopeClinic)).id).toBe(id);
      // out-of-scope cannot
      await expect(getSchedule(id, scopeOtherClinic)).rejects.toThrow();
      const otherList = await listSchedules({ page: 1, perPage: 100 } as any, scopeOtherClinic);
      expect(otherList.schedules.some((s) => s.id === id)).toBe(false);

      await deleteSchedule(id, scopeClinic);
    });

    it('getUnavailableSchedule returns the active block for the module', async () => {
      const { id } = await seedClinicSchedule({
        id: 9_000_320, moduleType: 'clinic', moduleId: CLINIC, selectionMode: 'range',
        startDate: '2026-08-01', endDate: '2026-08-10', status: 1,
      });
      const { unavailable } = await getUnavailableSchedule(
        { moduleType: 'clinic', moduleId: CLINIC, startDate: '2026-08-01', endDate: '2026-08-31' },
        scopeClinic,
      );
      expect(unavailable.some((u) => u.id === id)).toBe(true);

      await deleteSchedule(id, scopeClinic);
    });
  });
});
