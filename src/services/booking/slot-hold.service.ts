// src/services/booking/slot-hold.service.ts
// In-memory 15-minute slot hold mechanism for public booking.
// Key format: `${professionalId}:${serviceId}:${date}:${startTime}`
// For MVP — Redis can be substituted later.

export const SLOT_HOLD_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface SlotHold {
  key: string;
  professionalId: string;
  serviceId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  expiresAt: number; // epoch ms
}

export class SlotHoldService {
  private holds = new Map<string, SlotHold>();

  buildKey(professionalId: string, serviceId: string, date: string, startTime: string): string {
    return `${professionalId}:${serviceId}:${date}:${startTime}`;
  }

  /** Create or refresh a hold. Returns the new hold. */
  create(input: Omit<SlotHold, 'expiresAt' | 'key'> & { key?: string }): SlotHold {
    const key = input.key ?? this.buildKey(input.professionalId, input.serviceId, input.date, input.startTime);
    const expiresAt = Date.now() + SLOT_HOLD_TTL_MS;
    const hold: SlotHold = { ...input, key, expiresAt };
    this.holds.set(key, hold);
    return hold;
  }

  /** Returns the hold if it exists and is unexpired. Otherwise null. */
  get(key: string): SlotHold | null {
    const hold = this.holds.get(key);
    if (!hold) return null;
    if (Date.now() >= hold.expiresAt) {
      this.holds.delete(key);
      return null;
    }
    return hold;
  }

  /** Returns hold and time-remaining in seconds. */
  getWithRemaining(key: string): { hold: SlotHold; remainingSec: number } | null {
    const hold = this.get(key);
    if (!hold) return null;
    return { hold, remainingSec: Math.max(0, Math.floor((hold.expiresAt - Date.now()) / 1000)) };
  }

  /** Consume (delete) the hold. Returns true if it existed. */
  consume(key: string): boolean {
    return this.holds.delete(key);
  }

  /** Sweep all expired holds. Returns the count removed. */
  sweep(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, hold] of this.holds) {
      if (now >= hold.expiresAt) {
        this.holds.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Returns true if the slot is still available (no active hold AND no existing booking). */
  async isAvailable(
    key: string,
    bookingExists: () => Promise<boolean>,
  ): Promise<boolean> {
    if (this.get(key)) return false;
    return !(await bookingExists());
  }
}

const globalForBooking = globalThis as unknown as { __slotHoldService?: SlotHoldService };

export const slotHoldService: SlotHoldService =
  globalForBooking.__slotHoldService ?? new SlotHoldService();

if (process.env.NODE_ENV !== 'production') {
  globalForBooking.__slotHoldService = slotHoldService;
}