// src/services/booking/slot-generator.ts
// Generates available time slots for a professional on a given date.

export interface AvailabilityWindow {
  dayOfWeek: number;
  startMinute: number; // minutes from 00:00
  endMinute: number;
}

export interface ExistingBooking {
  startUtc: Date;
  endUtc: Date;
}

export interface SlotGeneratorInput {
  date: Date;
  duration: number; // service duration in minutes
  availability: AvailabilityWindow[];
  existingBookings: ExistingBooking[];
  bufferMinutes?: number; // gap between bookings
  slotIntervalMinutes?: number; // grid alignment, default = duration
}

export interface GeneratedSlot {
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  startUtc: Date;
  endUtc: Date;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function minutesToHHmm(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function generateSlots(input: SlotGeneratorInput): GeneratedSlot[] {
  const { date, duration, availability, existingBookings, bufferMinutes = 0, slotIntervalMinutes } = input;
  const interval = slotIntervalMinutes ?? duration;
  const dayOfWeek = date.getDay();

  const windows = availability.filter((w) => w.dayOfWeek === dayOfWeek);
  if (windows.length === 0) return [];

  const slots: GeneratedSlot[] = [];
  const now = new Date();

  for (const window of windows) {
    for (let m = window.startMinute; m + duration <= window.endMinute; m += interval) {
      const startUtc = new Date(date);
      startUtc.setHours(Math.floor(m / 60), m % 60, 0, 0);
      const endUtc = new Date(startUtc.getTime() + duration * 60_000);

      if (startUtc <= now) continue;

      // Check for overlap with existing bookings
      const overlaps = existingBookings.some(
        (b) => startUtc < b.endUtc && endUtc > b.startUtc,
      );
      if (overlaps) continue;

      slots.push({
        startTime: minutesToHHmm(m),
        endTime: minutesToHHmm(m + duration),
        startUtc,
        endUtc,
      });
    }
  }
  return slots;
}

export function formatSlotLabel(slot: GeneratedSlot): string {
  return `${slot.startTime} – ${slot.endTime}`;
}