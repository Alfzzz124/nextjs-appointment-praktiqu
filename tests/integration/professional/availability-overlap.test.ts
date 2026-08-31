/**
 * The contract of PUT /api/v1/professionals/:id/availability.
 *
 * These used to assert a payload of `{dayOfWeek, startMinute, endMinute}` — the shape the
 * route's zod schema accepted. The service behind that route reads `{day, startTime,
 * endTime, slotDurationMinutes}`, so every request that satisfied the schema was rejected
 * one layer down and the endpoint could never succeed. The tests missed it by checking the
 * schema in isolation and never calling the service, so they now go all the way through.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setAvailabilityInputSchema } from '@/services/professional/validation';
import { getWeeklySchedule, setWeeklySchedule } from '@/services/professional/availability.service';
import { assertTestDb, cleanup, seedClinicAdmin } from '../../billing/fixtures';

const CLINIC = 9_000_301, ADMIN = 9_000_302, DOCTOR = 9_000_310;

const window = (over: Record<string, unknown> = {}) => ({
  day: 'mon', startTime: '09:00', endTime: '12:00', slotDurationMinutes: 30, ...over,
});

describe('availability payload validation', () => {
  it('accepts the shape the service consumes, and pads HH:MM to HH:MM:SS', () => {
    const result = setAvailabilityInputSchema.safeParse({ schedule: [window()] });
    expect(result.success).toBe(true);
    expect(result.success && result.data.schedule[0]).toEqual({
      day: 'mon', startTime: '09:00:00', endTime: '12:00:00', slotDurationMinutes: 30,
    });
  });

  it('leaves an HH:MM:SS payload alone', () => {
    const result = setAvailabilityInputSchema.safeParse({
      schedule: [window({ startTime: '09:00:00', endTime: '12:00:00' })],
    });
    expect(result.success && result.data.schedule[0].startTime).toBe('09:00:00');
  });

  it('defaults the slot duration when the client omits it', () => {
    const { slotDurationMinutes, ...noSlot } = window();
    const result = setAvailabilityInputSchema.safeParse({ schedule: [noSlot] });
    expect(result.success && result.data.schedule[0].slotDurationMinutes).toBe(30);
  });

  it('rejects the old numeric shape, which no layer accepts', () => {
    const result = setAvailabilityInputSchema.safeParse({
      schedule: [{ dayOfWeek: 1, startMinute: 540, endMinute: 720 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an end at or before the start', () => {
    expect(setAvailabilityInputSchema.safeParse({
      schedule: [window({ startTime: '12:00', endTime: '09:00' })],
    }).success).toBe(false);
    expect(setAvailabilityInputSchema.safeParse({
      schedule: [window({ startTime: '09:00', endTime: '09:00' })],
    }).success).toBe(false);
  });

  it('rejects an unknown day and a malformed time', () => {
    expect(setAvailabilityInputSchema.safeParse({ schedule: [window({ day: 'monday' })] }).success).toBe(false);
    expect(setAvailabilityInputSchema.safeParse({ schedule: [window({ startTime: '9am' })] }).success).toBe(false);
  });

  it('rejects an empty schedule', () => {
    expect(setAvailabilityInputSchema.safeParse({ schedule: [] }).success).toBe(false);
  });
});

describe('availability service (FR-015)', () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedClinicAdmin({ userId: ADMIN, clinicId: CLINIC });
  });
  afterAll(cleanup);

  it('stores what the route validated — schema output feeds the service unchanged', async () => {
    const parsed = setAvailabilityInputSchema.safeParse({
      schedule: [
        window({ day: 'mon', startTime: '09:00', endTime: '12:00' }),
        window({ day: 'mon', startTime: '13:00', endTime: '17:00' }),
        window({ day: 'wed', startTime: '08:00', endTime: '11:00', slotDurationMinutes: 45 }),
      ],
    });
    expect(parsed.success).toBe(true);

    await setWeeklySchedule(DOCTOR, CLINIC, (parsed as any).data.schedule);

    const week = await getWeeklySchedule(DOCTOR, CLINIC);
    expect(week.mon.map((w) => `${w.startTime}-${w.endTime}`)).toEqual([
      '09:00:00-12:00:00', '13:00:00-17:00:00',
    ]);
    expect(week.wed[0].slotDurationMinutes).toBe(45);
    expect(week.tue).toEqual([]);
  });

  it('rejects two windows that cover the same minute', async () => {
    await expect(setWeeklySchedule(DOCTOR, CLINIC, [
      window({ startTime: '09:00:00', endTime: '12:00:00' }),
      window({ startTime: '11:00:00', endTime: '13:00:00' }),
    ] as any)).rejects.toMatchObject({ _tag: 'conflict' });
  });

  it('accepts adjacent windows on the same day', async () => {
    await expect(setWeeklySchedule(DOCTOR, CLINIC, [
      window({ startTime: '09:00:00', endTime: '10:00:00' }),
      window({ startTime: '10:00:00', endTime: '11:00:00' }),
    ] as any)).resolves.toBeDefined();
  });
});
