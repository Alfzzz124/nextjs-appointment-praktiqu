// src/services/booking/slot-hold.service.ts
// 15-minute slot holds for public booking, as signed tokens rather than server memory.
//
// A hold used to be an entry in a Map inside one Node process. The API runs several
// worker processes, so a hold taken on one worker was missing on the worker that
// received the booking: the guest was answered 410 hold_expired ("Slot no longer
// available") for a free slot, and the FE retried up to six times hoping to land on the
// right worker (audit M-6). Two holds on the same slot also shared one key, so one
// booking's consume() erased the other guest's hold. A token that any worker can verify
// has neither problem, and leaves nothing in memory for an anonymous caller to grow.
//
// A hold reserves nothing: slot lists never read holds, and the write path checks
// clashes itself. It only proves that the caller asked for a slot in the last 15 minutes.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SLOT_HOLD_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface SlotHold {
  key: string;
  professionalId: string;
  serviceId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  expiresAt: number; // epoch ms
}

/** Token version prefix. A different shape from every other token signed with AUTH_SECRET. */
const VERSION = 'h1';

/** Mixed into every signature, so no other token signed with AUTH_SECRET verifies as a hold. */
const DOMAIN = 'praktiqu-slot-hold';

/** Read per call, not at import: importing this module must not break a build without env. */
function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s && process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET must be set in production');
  }
  return s ?? 'dev-secret-change-me';
}

function signatureOf(payload: string): string {
  return createHmac('sha256', secret()).update(`${DOMAIN}.${payload}`).digest('base64url');
}

type Payload = { p: string; s: string; d: string; t: string; e: number };

function isPayload(v: unknown): v is Payload {
  const o = v as Record<string, unknown> | null;
  return (
    !!o &&
    typeof o.p === 'string' &&
    typeof o.s === 'string' &&
    typeof o.d === 'string' &&
    typeof o.t === 'string' &&
    typeof o.e === 'number' &&
    Number.isFinite(o.e)
  );
}

export class SlotHoldService {
  /** Mint a hold for a slot. Returns it with its token as `key`. */
  create(input: Omit<SlotHold, 'expiresAt' | 'key'>): SlotHold {
    const expiresAt = Date.now() + SLOT_HOLD_TTL_MS;
    const body: Payload = {
      p: input.professionalId,
      s: input.serviceId,
      d: input.date,
      t: input.startTime,
      e: expiresAt,
    };
    const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
    const key = `${VERSION}.${payload}.${signatureOf(payload)}`;
    return {
      key,
      professionalId: input.professionalId,
      serviceId: input.serviceId,
      date: input.date,
      startTime: input.startTime,
      expiresAt,
    };
  }

  /** The hold a token stands for, if its signature is ours and it has not expired. */
  get(key: string): SlotHold | null {
    if (typeof key !== 'string') return null;
    const parts = key.split('.');
    if (parts.length !== 3 || parts[0] !== VERSION) return null;
    const [, payload, sig] = parts;
    if (!payload || !sig) return null;

    const expected = Buffer.from(signatureOf(payload));
    const given = Buffer.from(sig);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    let body: unknown;
    try {
      body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (!isPayload(body) || Date.now() >= body.e) return null;

    return {
      key,
      professionalId: body.p,
      serviceId: body.s,
      date: body.d,
      startTime: body.t,
      expiresAt: body.e,
    };
  }

  /** Returns the hold and the time remaining in seconds. */
  getWithRemaining(key: string): { hold: SlotHold; remainingSec: number } | null {
    const hold = this.get(key);
    if (!hold) return null;
    return { hold, remainingSec: Math.max(0, Math.floor((hold.expiresAt - Date.now()) / 1000)) };
  }

  /**
   * Nothing to release: a token is not stored anywhere, and it stays valid until it
   * expires. Reusing one cannot double-book, because the write path checks clashes on
   * every attempt. Kept so the booking service's callers need not change in this commit.
   */
  consume(_key: string): void {}
}

export const slotHoldService = new SlotHoldService();
