/**
 * Every code path that cancels or confirms a booking has to know about psychologist approval.
 *
 * PENDING used to mean "unpaid", and several paths cancel unpaid bookings on their own
 * (payment expiry, the unpaid-booking release, a new off-day). Since approval, a PENDING
 * booking may be PAID and waiting for its psychologist, and a path that cancels it without
 * asking drops the client's money silently.
 *
 * This pins where an appointment's status is written, how many times per file, and which
 * of those files must consult the approval record. A new caller — or a new call in a
 * known file — fails here until someone decides, and writes down, whether it needs the
 * approval check. Same idea as tests/unit/db/last-insert-id-pinning.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** Comments may quote the calls they warn about; prose must not count as a write. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const WRITES =
  /\b(?:cancelAppointment|setSessionStatusDirect|setAppointmentStatus|bulkCancelSessions)\s*\(|kcAppointment\.update(?:Many)?\s*\(|UPDATE\s+wp_kc_appointments/g;

const APPROVAL_AWARE = /from '@\/services\/approval\/|from '\.\/store'/;

type Known = { writes: number; approvalAware: boolean; why: string };

const KNOWN: Record<string, Known> = {
  'src/services/session/session.service.ts': {
    writes: 4,
    approvalAware: true,
    why: 'transitionSession, off-day invalidation, bulk cancel (call + definition)',
  },
  'src/services/payments/payment.service.ts': {
    writes: 3,
    approvalAware: true,
    why: 'paid confirmation, expiry release, bill check-out',
  },
  'src/services/public/unpaid-booking.ts': { writes: 1, approvalAware: true, why: 'release of an unpaid guest booking' },
  'src/services/public/public-booking.service.ts': { writes: 1, approvalAware: true, why: "the client's own cancel link" },
  'src/services/approval/service.ts': { writes: 2, approvalAware: true, why: 'the approval decisions themselves' },
  'src/services/billing/bill.service.ts': {
    writes: 2,
    approvalAware: false,
    why: 'settling a bill checks out its appointment without consulting approval, so a booking still waiting for its psychologist can be checked out this way (accepted 2026-10-20); the approval reminder job then closes its record as approved outside the app (settleExternal)',
  },
  'src/app/api/v1/sessions/bulk/delete/route.ts': {
    writes: 1,
    approvalAware: false,
    why: 'calls bulkCancelSessions, which closes approval records itself',
  },
  'src/repositories/wp/sessions.repo.ts': { writes: 2, approvalAware: false, why: 'defines setSessionStatusDirect (raw UPDATE)' },
  'src/repositories/wp/appointments.write.ts': {
    writes: 3,
    approvalAware: false,
    why: 'defines setAppointmentStatus and cancelAppointment',
  },
};

function scan(): Map<string, { writes: number; aware: boolean }> {
  const found = new Map<string, { writes: number; aware: boolean }>();
  for (const file of walk(join(ROOT, 'src'))) {
    const source = stripComments(readFileSync(file, 'utf8'));
    const writes = (source.match(WRITES) ?? []).length;
    if (writes === 0) continue;
    found.set(relative(ROOT, file).split(sep).join('/'), { writes, aware: APPROVAL_AWARE.test(source) });
  }
  return found;
}

describe('appointment status writers', () => {
  const found = scan();

  it('are exactly the known files', () => {
    expect([...found.keys()].sort()).toEqual(Object.keys(KNOWN).sort());
  });

  it.each(Object.entries(KNOWN))('%s has the known number of writes', (file, known) => {
    expect(found.get(file)?.writes).toBe(known.writes);
  });

  it.each(Object.entries(KNOWN).filter(([, k]) => k.approvalAware))('%s consults the approval record', (file) => {
    expect(found.get(file)?.aware).toBe(true);
  });
});
