# OTP Email Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user sign in with a 6-digit code emailed to them, as an alternative to the password login that already exists.

**Architecture:** Two public endpoints under `/api/v1/auth/otp/`. Codes live in their own `otp_codes` table, stored as SHA-256 hashes with an expiry, a used marker and an attempt counter. `request` resolves the email through `ensureUserFromWordPress()` and mails a code; `verify` matches the newest live code and issues the same JWT pair `login()` issues. WordPress is not consulted during verify.

**Tech Stack:** Next.js App Router route handlers, Prisma (MySQL), Zod, Resend via `sendEmail()`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-18-otp-email-login-design.md`

## Global Constraints

- Code is **6 digits**, valid **10 minutes**, dead after **5 wrong attempts**.
- Resend cooldown **60 seconds**; at most **5 requests per 15 minutes** per `(IP, email)`.
- The code is **never stored or logged in plain text** — only its SHA-256.
- `POST /api/v1/auth/otp/request` **always answers 200** except for a malformed body or a rate-limit lockout. It must never reveal whether an address is registered.
- `POST /api/v1/auth/otp/verify` answers **exactly the same success body as `POST /api/v1/auth/login`**.
- Error bodies use `application/problem+json` via `src/lib/problem-details.ts`.
- **Never run `prisma db push` or `prisma migrate dev`.** This database holds the app's tables and KiviCare's `wp_*` tables side by side; Prisma would try to reconcile the half it does not know. Schema changes are hand-written, scoped SQL under `prisma/manual/`.
- Do not add values to the `AuditEventType` enum — that would mean an `ALTER TABLE` on the shared database.
- Run `npx tsc --noEmit` before every commit; it must report no errors.

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | `OtpCode` model + the back-relation on `User` |
| `prisma/manual/2026-08-18-create-otp-codes.sql` | The scoped `CREATE TABLE`, run by hand per environment |
| `src/lib/auth/otp.ts` | Pure primitives: generate, hash, compare, and the four policy constants |
| `src/lib/email.ts` | `buildOtpEmail()` alongside the existing `buildPasswordResetEmail()` |
| `src/services/auth/otp.service.ts` | `requestOtp()` and `verifyOtp()` — all the decisions |
| `src/app/api/v1/auth/otp/request/route.ts` | HTTP shell: parse, rate limit, map errors |
| `src/app/api/v1/auth/otp/verify/route.ts` | HTTP shell: parse, rate limit, map errors |
| `src/middleware.ts` | Add `/api/v1/auth/otp` to `PUBLIC_API_PREFIXES` |
| `src/services/audit.ts` | Widen `LoginSuccessMeta.method` to include `'otp'` |
| `docs/api/OTP-LOGIN-GUIDE.md` | Contract for the front-end team |

The service is a new file rather than more lines in `src/services/auth/service.ts`, which is already ~810 lines. `src/services/auth/admin-auth.service.ts` sets the precedent.

---

### Task 1: `otp_codes` table

**Files:**
- Modify: `prisma/schema.prisma` (add model after `PasswordResetToken`, which ends at line 188; add relation in `User` after line 102)
- Create: `prisma/manual/2026-08-18-create-otp-codes.sql`

**Interfaces:**
- Consumes: nothing
- Produces: Prisma model `OtpCode` with fields `id: string`, `userId: string`, `codeHash: string`, `expiresAt: Date`, `usedAt: Date | null`, `attempts: number`, `createdAt: Date`, `ipAddress: string | null`, `userAgent: string | null`. Client accessor is `prisma.otpCode`.

- [ ] **Step 1: Add the model to `prisma/schema.prisma`**

Insert immediately after the closing brace of `model PasswordResetToken` (line 188):

```prisma
/// A one-time sign-in code. Mirrors PasswordResetToken, with one deliberate
/// difference: codeHash is NOT unique. A reset token is 32 random bytes, so a unique
/// index is safe there. Six digits collide between users sooner or later, and a unique
/// index would turn that collision into a failed login for whoever arrived second.
/// Lookup is therefore by userId, newest live row first.
model OtpCode {
  id        String    @id @default(cuid())
  userId    String
  codeHash  String // SHA-256 of the 6 digits — never the code itself
  expiresAt DateTime
  usedAt    DateTime?
  attempts  Int       @default(0)
  createdAt DateTime  @default(now())
  ipAddress String?
  userAgent String?   @db.Text

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
  @@map("otp_codes")
}
```

- [ ] **Step 2: Add the back-relation on `User`**

In `model User`, directly after the `passwordResets` line (line 102):

```prisma
  otpCodes          OtpCode[]
```

- [ ] **Step 3: Validate the schema and regenerate the client**

Run: `npx prisma validate && npx prisma generate`
Expected: `The schema at prisma/schema.prisma is valid` followed by `Generated Prisma Client`.

Do **not** run `prisma db push`. If you typed it by reflex, stop and read the Global Constraints.

- [ ] **Step 4: Write the scoped migration SQL**

Create `prisma/manual/2026-08-18-create-otp-codes.sql`:

```sql
-- One-time sign-in codes. Apply by hand, per environment:
--   mysql -u <user> -p <database> < prisma/manual/2026-08-18-create-otp-codes.sql
--
-- Written out rather than generated because this database also holds KiviCare's
-- wp_* tables, and `prisma db push` would try to reconcile them against a schema
-- that does not describe them.
CREATE TABLE IF NOT EXISTS `otp_codes` (
  `id`        varchar(191) NOT NULL,
  `userId`    varchar(191) NOT NULL,
  `codeHash`  varchar(191) NOT NULL,
  `expiresAt` datetime(3)  NOT NULL,
  `usedAt`    datetime(3)      NULL,
  `attempts`  int(11)      NOT NULL DEFAULT 0,
  `createdAt` datetime(3)  NOT NULL DEFAULT current_timestamp(3),
  `ipAddress` varchar(191)     NULL,
  `userAgent` text             NULL,
  PRIMARY KEY (`id`),
  KEY `otp_codes_userId_idx` (`userId`),
  KEY `otp_codes_expiresAt_idx` (`expiresAt`),
  CONSTRAINT `otp_codes_userId_fkey` FOREIGN KEY (`userId`)
    REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: `No errors found`. This proves the generated client exposes `prisma.otpCode`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/manual/2026-08-18-create-otp-codes.sql
git commit -m "feat(otp): add otp_codes table

codeHash is deliberately not unique: six digits collide between users, and a
unique index would turn that collision into a failed login for the second one."
```

---

### Task 2: OTP primitives

**Files:**
- Create: `src/lib/auth/otp.ts`
- Test: `tests/unit/otp-code.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `OTP_LENGTH: number` (6), `OTP_TTL_MS: number` (600000), `OTP_MAX_ATTEMPTS: number` (5), `OTP_RESEND_COOLDOWN_MS: number` (60000), `generateOtpCode(): string`, `hashOtpCode(code: string): string`, `codesMatch(rawCode: string, storedHash: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/otp-code.test.ts`:

```typescript
/**
 * OTP primitives. Small surface, but every property here is load-bearing: a code that
 * is not always six characters breaks the client input mask, a hash that leaks the code
 * defeats the point of hashing, and a comparison that short-circuits on the first
 * differing byte leaks the code one byte at a time.
 */
import { describe, it, expect } from 'vitest';
import {
  OTP_LENGTH,
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  generateOtpCode,
  hashOtpCode,
  codesMatch,
} from '@/lib/auth/otp';

describe('policy constants', () => {
  it('matches the agreed policy', () => {
    expect(OTP_LENGTH).toBe(6);
    expect(OTP_TTL_MS).toBe(10 * 60_000);
    expect(OTP_MAX_ATTEMPTS).toBe(5);
    expect(OTP_RESEND_COOLDOWN_MS).toBe(60_000);
  });
});

describe('generateOtpCode', () => {
  it('always returns exactly six digits', () => {
    for (let i = 0; i < 500; i++) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it('pads a small draw rather than returning a short code', () => {
    // One draw in ten starts with a zero, so across 500 draws seeing none would mean
    // padding is broken — not bad luck.
    const codes = Array.from({ length: 500 }, generateOtpCode);
    expect(codes.some((c) => c.startsWith('0'))).toBe(true);
  });

  it('does not return the same code every time', () => {
    const codes = new Set(Array.from({ length: 50 }, generateOtpCode));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('hashOtpCode', () => {
  it('is deterministic', () => {
    expect(hashOtpCode('418902')).toBe(hashOtpCode('418902'));
  });

  it('does not contain the code', () => {
    expect(hashOtpCode('418902')).not.toContain('418902');
  });

  it('produces a 64-character hex digest', () => {
    expect(hashOtpCode('418902')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives different codes different hashes', () => {
    expect(hashOtpCode('418902')).not.toBe(hashOtpCode('418903'));
  });
});

describe('codesMatch', () => {
  it('accepts the right code', () => {
    expect(codesMatch('418902', hashOtpCode('418902'))).toBe(true);
  });

  it('rejects the wrong code', () => {
    expect(codesMatch('000000', hashOtpCode('418902'))).toBe(false);
  });

  it('rejects a stored hash that is not a hex digest rather than throwing', () => {
    expect(codesMatch('418902', 'not-a-hash')).toBe(false);
  });

  it('rejects an empty stored hash', () => {
    expect(codesMatch('418902', '')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/unit/otp-code.test.ts --reporter=basic`
Expected: FAIL — `Cannot find module '@/lib/auth/otp'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/auth/otp.ts`:

```typescript
/**
 * One-time sign-in code primitives.
 *
 * Kept apart from the service so the rules that are easy to get subtly wrong — padding,
 * hashing, constant-time comparison — can be tested without a database or a mail server.
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/** Digits in a code. Six is the agreed policy; the client input mask assumes it. */
export const OTP_LENGTH = 6;

/** How long a code stays usable. */
export const OTP_TTL_MS = 10 * 60_000;

/** Wrong guesses a single code tolerates before it is dead. */
export const OTP_MAX_ATTEMPTS = 5;

/** Minimum gap between two send requests for the same account. */
export const OTP_RESEND_COOLDOWN_MS = 60_000;

/**
 * A uniformly random code, zero-padded.
 *
 * `randomInt` is the CSPRNG; `Math.random()` would be guessable from earlier draws.
 * Padding matters: without it one draw in ten produces a five-digit string.
 */
export function generateOtpCode(): string {
  const max = 10 ** OTP_LENGTH;
  return String(randomInt(0, max)).padStart(OTP_LENGTH, '0');
}

/** SHA-256 hex digest. Plain SHA-256 rather than a slow KDF is deliberate: the code dies
 *  in ten minutes after five guesses, so the threat a KDF defends against does not apply,
 *  and verify runs on every attempt. */
export function hashOtpCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Constant-time comparison of a submitted code against a stored digest.
 *
 * Returns false for a malformed stored value rather than throwing — a corrupt row should
 * fail the login, not the request.
 */
export function codesMatch(rawCode: string, storedHash: string): boolean {
  const expected = Buffer.from(hashOtpCode(rawCode), 'hex');
  let actual: Buffer;
  try {
    actual = Buffer.from(storedHash, 'hex');
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/unit/otp-code.test.ts --reporter=basic`
Expected: `PASS (12) FAIL (0)`

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/auth/otp.ts tests/unit/otp-code.test.ts
git commit -m "feat(otp): code generation, hashing and constant-time comparison"
```

---

### Task 3: The OTP email

**Files:**
- Modify: `src/lib/email.ts` (add after `buildPasswordResetEmail`, which ends around line 101)
- Test: `tests/unit/otp-email.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `buildOtpEmail(input: { code: string; ttlMinutes: number }): { subject: string; html: string; text: string }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/otp-email.test.ts`:

```typescript
/**
 * The sign-in code email.
 *
 * The template lives in code on purpose. KiviCare's registration template lives in the
 * WordPress database, and that is how a plaintext password ended up being mailed to
 * patients — nobody reviewing the repo could see it.
 */
import { describe, it, expect } from 'vitest';
import { buildOtpEmail } from '@/lib/email';

describe('buildOtpEmail', () => {
  const mail = buildOtpEmail({ code: '418902', ttlMinutes: 10 });

  it('puts the code in the subject, so it is readable from a notification', () => {
    expect(mail.subject).toContain('418902');
  });

  it('puts the code in the html body', () => {
    expect(mail.html).toContain('418902');
  });

  it('puts the code in the plain-text body', () => {
    expect(mail.text).toContain('418902');
  });

  it('tells the reader how long it lasts', () => {
    expect(mail.text).toContain('10');
  });

  it('tells the reader what to do if it was not them', () => {
    expect(mail.text.toLowerCase()).toContain('ignore');
  });

  it('carries no link — a code email that also contains a link trains people to click', () => {
    expect(mail.html).not.toContain('<a ');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/unit/otp-email.test.ts --reporter=basic`
Expected: FAIL — `buildOtpEmail is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/email.ts`, after `buildPasswordResetEmail`:

```typescript
/** Build a sign-in code email. No link: a code mail that also contains a link teaches
 *  people to click links in mail that asks for credentials. */
export function buildOtpEmail(input: {
  code: string;
  ttlMinutes: number;
}): { subject: string; html: string; text: string } {
  return {
    subject: `${input.code} is your PraktiQU sign-in code`,
    html: `<p>Your PraktiQU sign-in code is:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px">${input.code}</p>
<p>It expires in ${input.ttlMinutes} minutes.</p>
<p>If you didn't try to sign in, you can ignore this email.</p>`,
    text: `Your PraktiQU sign-in code is ${input.code}. It expires in ${input.ttlMinutes} minutes. If you didn't try to sign in, you can ignore this email.`,
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/unit/otp-email.test.ts --reporter=basic`
Expected: `PASS (6) FAIL (0)`

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/email.ts tests/unit/otp-email.test.ts
git commit -m "feat(otp): sign-in code email template"
```

---

### Task 4: `requestOtp()`

**Files:**
- Create: `src/services/auth/otp.service.ts`
- Test: `tests/integration/auth/otp-request.test.ts`

**Interfaces:**
- Consumes: `ensureUserFromWordPress(email: string)` and `normaliseEmail(email: string)` from `@/services/auth/service`; everything from Task 2; `buildOtpEmail` from Task 3.
- Produces: `requestOtp(input: { email: string; ip: string; userAgent: string }): Promise<{ retryAfterSeconds: number }>`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/auth/otp-request.test.ts`:

```typescript
/**
 * requestOtp — mailing a sign-in code.
 *
 * The rule that shapes most of this: the caller must not be able to tell whether an
 * address is registered. Every branch returns the same thing; only the side effects differ.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = {
  user: { findUnique: vi.fn(), upsert: vi.fn() },
  otpCode: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
};
vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

vi.mock('@/lib/auth/wp-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/wp-auth')>()),
  wpLookupByEmail: vi.fn(),
}));

vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/services/audit', () => ({
  audit: {
    loginSuccess: vi.fn().mockResolvedValue(undefined),
    loginFailure: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(undefined),
    passwordChange: vi.fn().mockResolvedValue(undefined),
    roleChange: vi.fn().mockResolvedValue(undefined),
  },
}));

const { requestOtp } = await import('@/services/auth/otp.service');
const { sendEmail } = await import('@/lib/email');
const { wpLookupByEmail } = await import('@/lib/auth/wp-auth');
const { hashOtpCode } = await import('@/lib/auth/otp');

const USER = { id: 'user-1', email: 'budi@example.com', status: 1 };
const INPUT = { email: 'Budi@Example.com', ip: '203.0.113.9', userAgent: 'vitest' };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue(USER);
  mockPrisma.otpCode.findFirst.mockResolvedValue(null);
  mockPrisma.otpCode.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.otpCode.create.mockResolvedValue({});
  vi.mocked(wpLookupByEmail).mockResolvedValue(null);
});

describe('requestOtp', () => {
  it('mails a code to a known address', async () => {
    await requestOtp(INPUT);

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'budi@example.com' }),
    );
  });

  it('stores the hash of the code, never the code itself', async () => {
    await requestOtp(INPUT);

    const mailed = vi.mocked(sendEmail).mock.calls[0]![0]!.text!;
    const code = mailed.match(/\b(\d{6})\b/)![1]!;
    const stored = mockPrisma.otpCode.create.mock.calls[0]![0].data;

    expect(stored.codeHash).toBe(hashOtpCode(code));
    expect(stored.codeHash).not.toContain(code);
  });

  it('kills any earlier live code so only the newest works', async () => {
    await requestOtp(INPUT);

    expect(mockPrisma.otpCode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', usedAt: null } }),
    );
  });

  it('sends nothing for an address neither the app nor WordPress knows', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    vi.mocked(wpLookupByEmail).mockResolvedValue(null);

    const result = await requestOtp({ ...INPUT, email: 'hantu@example.com' });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(mockPrisma.otpCode.create).not.toHaveBeenCalled();
    // Same shape as the success path — the caller cannot tell the difference.
    expect(result.retryAfterSeconds).toBe(60);
  });

  it('reaches WordPress for someone who has never logged into the app', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    vi.mocked(wpLookupByEmail).mockResolvedValue({
      wpUserId: BigInt(310),
      email: 'lama@example.com',
      username: 'lama',
      displayName: 'Pasien Lama',
      firstName: 'Pasien',
      lastName: 'Lama',
      roles: ['kiviCare_patient'],
      status: 'active' as const,
    });
    mockPrisma.user.upsert.mockResolvedValue({ id: 'user-lama', email: 'lama@example.com', status: 1 });

    await requestOtp({ ...INPUT, email: 'lama@example.com' });

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'lama@example.com' }));
  });

  it('stays silent inside the 60 second cooldown', async () => {
    mockPrisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      createdAt: new Date(Date.now() - 20_000),
    });

    const result = await requestOtp(INPUT);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(mockPrisma.otpCode.create).not.toHaveBeenCalled();
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(40);
  });

  it('sends again once the cooldown has passed', async () => {
    mockPrisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      createdAt: new Date(Date.now() - 61_000),
    });

    await requestOtp(INPUT);

    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('records the requester so a flood can be traced', async () => {
    await requestOtp(INPUT);

    expect(mockPrisma.otpCode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ipAddress: '203.0.113.9', userAgent: 'vitest' }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/integration/auth/otp-request.test.ts --reporter=basic`
Expected: FAIL — `Cannot find module '@/services/auth/otp.service'`.

- [ ] **Step 3: Write the implementation**

Create `src/services/auth/otp.service.ts`:

```typescript
/**
 * Sign-in by one-time code, as an alternative to the password login in `service.ts`.
 *
 * Design notes worth keeping in mind while reading:
 *
 * - `request` gives the same answer whether or not the address is registered. Any branch
 *   that returns something distinguishable is a way to enumerate accounts.
 * - Resolution goes through `ensureUserFromWordPress`, not `prisma.user.findUnique`. Most
 *   accounts have no `users` row until their first app login; looking only at the app table
 *   would exclude them, which is exactly the bug that left 789 of 850 staging users unable
 *   to reset a password.
 * - Codes are found by `userId`, not by hash: six digits collide between users.
 */

import { prisma } from '@/lib/db';
import { buildOtpEmail, sendEmail } from '@/lib/email';
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  codesMatch,
  generateOtpCode,
  hashOtpCode,
} from '@/lib/auth/otp';
import { ensureUserFromWordPress, normaliseEmail } from '@/services/auth/service';

export interface RequestOtpInput {
  email: string;
  ip: string;
  userAgent: string;
}

const COOLDOWN_SECONDS = Math.ceil(OTP_RESEND_COOLDOWN_MS / 1000);

/**
 * Mail a fresh code, unless one was just sent.
 *
 * Always resolves. `retryAfterSeconds` is how long the caller should disable its resend
 * button — the same number whether or not anything was actually sent.
 */
export async function requestOtp(input: RequestOtpInput): Promise<{ retryAfterSeconds: number }> {
  const email = normaliseEmail(input.email);

  const user = await ensureUserFromWordPress(email);
  if (!user) return { retryAfterSeconds: COOLDOWN_SECONDS };

  const latest = await prisma.otpCode.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });
  if (latest) {
    const elapsed = Date.now() - latest.createdAt.getTime();
    if (elapsed < OTP_RESEND_COOLDOWN_MS) {
      // Silent: answering differently here would turn the cooldown into an oracle for
      // which addresses exist.
      return { retryAfterSeconds: Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsed) / 1000) };
    }
  }

  await prisma.otpCode.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const code = generateOtpCode();
  await prisma.otpCode.create({
    data: {
      userId: user.id,
      codeHash: hashOtpCode(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      ipAddress: input.ip,
      userAgent: input.userAgent,
    },
  });

  const mail = buildOtpEmail({ code, ttlMinutes: Math.round(OTP_TTL_MS / 60_000) });
  await sendEmail({
    to: user.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    template: 'otp-login',
  });

  return { retryAfterSeconds: COOLDOWN_SECONDS };
}
```

Note: `OTP_MAX_ATTEMPTS` and `codesMatch` are imported here for Task 6 and are unused until then. If your linter fails the build on unused imports, add them in Task 6 instead.

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/integration/auth/otp-request.test.ts --reporter=basic`
Expected: `PASS (8) FAIL (0)`

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/services/auth/otp.service.ts tests/integration/auth/otp-request.test.ts
git commit -m "feat(otp): requestOtp — mail a code, silent inside the cooldown"
```

---

### Task 5: `POST /api/v1/auth/otp/request`

**Files:**
- Create: `src/app/api/v1/auth/otp/request/route.ts`
- Modify: `src/middleware.ts:20`
- Test: `tests/integration/auth/otp-request-route.test.ts`

**Interfaces:**
- Consumes: `requestOtp` from Task 4
- Produces: `POST` handler answering `200 { message: string, retryAfter: number }`, `400 invalid_body`, `400 validation_error`, `429 rate_limited`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/auth/otp-request-route.test.ts`:

```typescript
/**
 * POST /api/v1/auth/otp/request — the HTTP shell around requestOtp.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/services/auth/otp.service', () => ({
  requestOtp: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
}));

const mockLimiter = {
  check: vi.fn().mockReturnValue({ kind: 'allow' }),
  recordFailure: vi.fn(),
  recordSuccess: vi.fn(),
};
vi.mock('@/lib/rate-limit', () => ({
  createRateLimiter: vi.fn(() => mockLimiter),
  DEFAULT_RATE_LIMIT_CONFIG: {},
  tupleKey: vi.fn((a: string, b: string) => `${a}:${b}`),
}));

const { POST } = await import('@/app/api/v1/auth/otp/request/route');
const { requestOtp } = await import('@/services/auth/otp.service');

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/v1/auth/otp/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLimiter.check.mockReturnValue({ kind: 'allow' });
  vi.mocked(requestOtp).mockResolvedValue({ retryAfterSeconds: 60 });
});

describe('POST /api/v1/auth/otp/request', () => {
  it('returns 200 with the countdown the front-end needs', async () => {
    const res = await POST(makeReq({ email: 'budi@example.com' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.retryAfter).toBe(60);
    expect(typeof json.message).toBe('string');
  });

  it('answers an unknown address exactly like a known one', async () => {
    vi.mocked(requestOtp).mockResolvedValue({ retryAfterSeconds: 60 });

    const res = await POST(makeReq({ email: 'hantu@example.com' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      message: expect.any(String),
      retryAfter: 60,
    });
  });

  it('rejects a malformed email with 400', async () => {
    const res = await POST(makeReq({ email: 'bukan-email' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('validation_error');
    expect(requestOtp).not.toHaveBeenCalled();
  });

  it('rejects a body that is not JSON with 400', async () => {
    const req = new NextRequest('http://localhost/api/v1/auth/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'bukan json',
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_body');
  });

  it('returns 429 with Retry-After once the sender is locked out', async () => {
    mockLimiter.check.mockReturnValue({ kind: 'lockout', retryAfterMs: 900_000 });

    const res = await POST(makeReq({ email: 'budi@example.com' }));

    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('rate_limited');
    expect(res.headers.get('Retry-After')).toBe('900');
    expect(requestOtp).not.toHaveBeenCalled();
  });

  it('counts every request, registered or not, so the limiter cannot be used as an oracle', async () => {
    await POST(makeReq({ email: 'budi@example.com' }));

    expect(mockLimiter.recordFailure).toHaveBeenCalled();
    expect(mockLimiter.recordSuccess).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/integration/auth/otp-request-route.test.ts --reporter=basic`
Expected: FAIL — `Cannot find module '@/app/api/v1/auth/otp/request/route'`.

- [ ] **Step 3: Write the route**

Create `src/app/api/v1/auth/otp/request/route.ts`:

```typescript
/**
 * POST /api/v1/auth/otp/request
 *
 * Mails a one-time sign-in code. Public — no token required.
 *
 * Always answers 200 apart from a malformed body or a rate-limit lockout, so the response
 * cannot be used to discover which addresses are registered.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requestOtp } from '@/services/auth/otp.service';
import { badRequest, tooManyRequests, problemHeaders } from '@/lib/problem-details';
import { createRateLimiter, tupleKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const INSTANCE = '/api/v1/auth/otp/request';

/**
 * Five sends per quarter hour per (IP, address). Every request is counted, whether or not
 * it resulted in mail — counting only the misses would make lockout behaviour differ
 * between registered and unregistered addresses, which is the leak the 200 avoids.
 */
const limiter = createRateLimiter({
  config: {
    windowMs: 15 * 60_000,
    progressiveAfter: 5,
    progressiveDelayMs: 0,
    lockoutAfter: 5,
    lockoutMs: 15 * 60_000,
  },
});

const BodySchema = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const p = badRequest('invalid_body', 'Request body must be valid JSON', INSTANCE);
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    const p = badRequest('validation_error', 'A valid email address is required', INSTANCE);
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    '0.0.0.0';
  const userAgent = req.headers.get('user-agent') ?? 'unknown';
  const email = parsed.data.email.trim().toLowerCase();

  const key = tupleKey(ip, email);
  const verdict = limiter.check(key);
  if (verdict.kind === 'lockout') {
    const retryAfter = Math.ceil(verdict.retryAfterMs / 1000);
    const p = tooManyRequests('rate_limited', retryAfter, 'Too many code requests', INSTANCE);
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }
  limiter.recordFailure(key);

  const { retryAfterSeconds } = await requestOtp({ email, ip, userAgent });

  return NextResponse.json(
    { message: 'If that email exists, a code has been sent.', retryAfter: retryAfterSeconds },
    { status: 200 },
  );
}
```

- [ ] **Step 4: Add the route to the public list**

In `src/middleware.ts` line 20, add `'/api/v1/auth/otp'` to `PUBLIC_API_PREFIXES`, immediately after `'/api/v1/public'`:

```typescript
const PUBLIC_API_PREFIXES = ['/api/v1/public', '/api/v1/auth/otp', '/api/v1/auth/login', '/api/v1/auth/register', '/api/v1/auth/refresh', '/api/v1/auth/forgot-password', '/api/v1/auth/reset-password', '/api/v1/webhooks/wordpress', '/api/v1/webhooks/wordpress-jobs', '/api/v1/auth/health', '/api/health'];
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run tests/integration/auth/otp-request-route.test.ts --reporter=basic`
Expected: `PASS (6) FAIL (0)`

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/api/v1/auth/otp/request/route.ts src/middleware.ts tests/integration/auth/otp-request-route.test.ts
git commit -m "feat(otp): POST /api/v1/auth/otp/request"
```

---

### Task 6: `verifyOtp()`

**Files:**
- Modify: `src/services/auth/otp.service.ts`
- Modify: `src/services/audit.ts:49`
- Test: `tests/integration/auth/otp-verify.test.ts`

**Interfaces:**
- Consumes: `issueTokensForUser`, `AuthError`, `normaliseEmail` from `@/services/auth/service`; `codesMatch`, `hashOtpCode`, `OTP_MAX_ATTEMPTS` from Task 2
- Produces: `verifyOtp(input: { email: string; code: string; ip: string; userAgent: string }): Promise<VerifyOtpResult>` where `VerifyOtpResult` extends `IssuedTokens` with `user: LoginResult['user']`. Throws `AuthError` with codes `invalid_code` (400), `code_expired` (400), `too_many_attempts` (400), `account_inactive` (403).

- [ ] **Step 1: Widen the audit method union**

In `src/services/audit.ts` line 49, change:

```typescript
  method: 'password' | 'google';
```

to:

```typescript
  method: 'password' | 'google' | 'otp';
```

This is the entire audit change. `AuditEventType` is untouched — adding a value there would require an `ALTER TABLE` on a database shared with KiviCare.

- [ ] **Step 2: Write the failing test**

Create `tests/integration/auth/otp-verify.test.ts`:

```typescript
/**
 * verifyOtp — trading a code for a session.
 *
 * The attempt counter is the only thing standing between a six-digit secret and a
 * brute-force, so most of these tests are about it holding.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = {
  user: { findUnique: vi.fn(), update: vi.fn() },
  otpCode: { findFirst: vi.fn(), update: vi.fn() },
  refreshToken: { create: vi.fn().mockResolvedValue({}) },
};
vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

vi.mock('@/services/audit', () => ({
  audit: {
    loginSuccess: vi.fn().mockResolvedValue(undefined),
    loginFailure: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(undefined),
    passwordChange: vi.fn().mockResolvedValue(undefined),
    roleChange: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/auth/jwt', () => ({
  issueAccessToken: vi.fn().mockResolvedValue({
    token: 'mock-access-token',
    expiresAt: new Date('2026-08-18T01:00:00.000Z'),
  }),
  issueRefreshToken: vi.fn().mockReturnValue({
    token: 'mock-refresh-token',
    tokenHash: 'mock-hash',
    familyId: 'mock-family',
    expiresAt: new Date('2026-08-25T00:00:00.000Z'),
  }),
  hashToken: vi.fn((t: string) => `hash-${t}`),
  JWT_CONFIG: { accessTokenTtlMs: 3_600_000, refreshTokenTtlMs: 604_800_000 },
  verifyAccessToken: vi.fn(),
}));

const { verifyOtp } = await import('@/services/auth/otp.service');
const { hashOtpCode } = await import('@/lib/auth/otp');
const { audit } = await import('@/services/audit');

const USER = {
  id: 'user-1',
  email: 'budi@example.com',
  username: 'budi',
  firstName: 'Budi',
  lastName: 'Santoso',
  displayName: 'Budi Santoso',
  role: 'CLIENT',
  wpUserId: BigInt(924),
  status: 1,
  emailVerified: null,
};

const CODE = '418902';

function liveCode(over: Record<string, unknown> = {}) {
  return {
    id: 'otp-1',
    userId: 'user-1',
    codeHash: hashOtpCode(CODE),
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    attempts: 0,
    ...over,
  };
}

const INPUT = { email: 'Budi@Example.com', code: CODE, ip: '203.0.113.9', userAgent: 'vitest' };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue(USER);
  mockPrisma.user.update.mockResolvedValue(USER);
  mockPrisma.otpCode.findFirst.mockResolvedValue(liveCode());
  mockPrisma.otpCode.update.mockResolvedValue({});
  mockPrisma.refreshToken.create.mockResolvedValue({});
});

describe('verifyOtp', () => {
  it('returns a session for the right code', async () => {
    const result = await verifyOtp(INPUT);

    expect(result.accessToken).toBe('mock-access-token');
    expect(result.refreshToken).toBe('mock-refresh-token');
    expect(result.user).toMatchObject({ id: 'user-1', email: 'budi@example.com', role: 'CLIENT' });
  });

  it('marks the code used so it cannot be replayed', async () => {
    await verifyOtp(INPUT);

    expect(mockPrisma.otpCode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'otp-1' },
        data: expect.objectContaining({ usedAt: expect.any(Date) }),
      }),
    );
  });

  it('records the login as otp, not password', async () => {
    await verifyOtp(INPUT);

    expect(audit.loginSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', method: 'otp' }),
      expect.anything(),
    );
  });

  it('counts a wrong code against the attempt limit', async () => {
    await expect(verifyOtp({ ...INPUT, code: '000000' })).rejects.toMatchObject({
      code: 'invalid_code',
      status: 400,
    });

    expect(mockPrisma.otpCode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'otp-1' },
        data: { attempts: { increment: 1 } },
      }),
    );
  });

  it('reports a burned code as burned, not as a wrong guess', async () => {
    mockPrisma.otpCode.findFirst.mockResolvedValue(liveCode({ attempts: 5 }));

    // A wrong guess against a spent code must say too_many_attempts, which proves the
    // attempt check runs before the comparison.
    await expect(verifyOtp({ ...INPUT, code: '000000' })).rejects.toMatchObject({
      code: 'too_many_attempts',
    });
  });

  it('refuses the right code once the attempt limit is spent', async () => {
    mockPrisma.otpCode.findFirst.mockResolvedValue(liveCode({ attempts: 5 }));

    // Being correct must not rescue a burned code.
    await expect(verifyOtp(INPUT)).rejects.toMatchObject({ code: 'too_many_attempts' });
  });

  it('refuses an expired code', async () => {
    mockPrisma.otpCode.findFirst.mockResolvedValue(
      liveCode({ expiresAt: new Date(Date.now() - 1_000) }),
    );

    await expect(verifyOtp(INPUT)).rejects.toMatchObject({ code: 'code_expired' });
  });

  it('says invalid_code, not "no such user", for an unknown address', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(verifyOtp({ ...INPUT, email: 'hantu@example.com' })).rejects.toMatchObject({
      code: 'invalid_code',
    });
  });

  it('says invalid_code when the account has no live code at all', async () => {
    mockPrisma.otpCode.findFirst.mockResolvedValue(null);

    await expect(verifyOtp(INPUT)).rejects.toMatchObject({ code: 'invalid_code' });
  });

  it('rejects an inactive account after the code matched, not before', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...USER, status: 0 });

    await expect(verifyOtp(INPUT)).rejects.toMatchObject({
      code: 'account_inactive',
      status: 403,
    });
    // The code is spent either way — an inactive account must not be a free retry loop.
    expect(mockPrisma.otpCode.update).toHaveBeenCalled();
  });

  it('marks the address verified, since receiving the code proves it', async () => {
    await verifyOtp(INPUT);

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({ emailVerified: expect.any(Date) }),
      }),
    );
  });

  it('leaves an already-verified address alone', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...USER, emailVerified: new Date('2026-01-01') });

    await verifyOtp(INPUT);

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('only considers this user\'s codes, so a shared six digits cannot cross accounts', async () => {
    await verifyOtp(INPUT);

    expect(mockPrisma.otpCode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', usedAt: null } }),
    );
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `npx vitest run tests/integration/auth/otp-verify.test.ts --reporter=basic`
Expected: FAIL — `verifyOtp is not a function`.

- [ ] **Step 4: Write the implementation**

Append to `src/services/auth/otp.service.ts`:

```typescript
import { audit } from '@/services/audit';
import {
  AuthError,
  issueTokensForUser,
  type IssuedTokens,
  type LoginResult,
} from '@/services/auth/service';

export interface VerifyOtpInput {
  email: string;
  code: string;
  ip: string;
  userAgent: string;
}

export interface VerifyOtpResult extends IssuedTokens {
  user: LoginResult['user'];
}

/**
 * Trade a code for a session.
 *
 * Every rejection before a match answers `invalid_code` regardless of cause, so verify
 * cannot be used to discover which addresses exist — the same rule `request` follows.
 */
export async function verifyOtp(input: VerifyOtpInput): Promise<VerifyOtpResult> {
  const email = normaliseEmail(input.email);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new AuthError('invalid_code', 400, 'That code is not valid');

  const record = await prisma.otpCode.findFirst({
    where: { userId: user.id, usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!record) throw new AuthError('invalid_code', 400, 'That code is not valid');

  if (record.expiresAt.getTime() <= Date.now()) {
    throw new AuthError('code_expired', 400, 'That code has expired — request a new one');
  }
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    // Checked before comparing: a burned code must stay burned even for the right digits.
    throw new AuthError('too_many_attempts', 400, 'Too many wrong attempts — request a new code');
  }

  if (!codesMatch(input.code, record.codeHash)) {
    await prisma.otpCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    throw new AuthError('invalid_code', 400, 'That code is not valid');
  }

  // Spend the code before deciding anything else about the account, so a rejected login
  // cannot be retried against the same digits.
  await prisma.otpCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });

  if (user.status === 0) {
    throw new AuthError('account_inactive', 403, 'Account is inactive');
  }

  if (!user.emailVerified) {
    // Reading the code proves control of the mailbox.
    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } });
  }

  const tokens = await issueTokensForUser(user, input.ip, input.userAgent);

  await audit.loginSuccess(
    {
      userId: user.id,
      timestamp: new Date().toISOString(),
      ip: input.ip,
      userAgent: input.userAgent,
      method: 'otp',
    },
    { ip: input.ip, userAgent: input.userAgent },
  );

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      role: user.role,
      wpUserId: user.wpUserId,
    },
    ...tokens,
  };
}
```

Move the two new `import` statements to the top of the file with the others.

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run tests/integration/auth/otp-verify.test.ts --reporter=basic`
Expected: `PASS (13) FAIL (0)`

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/services/auth/otp.service.ts src/services/audit.ts tests/integration/auth/otp-verify.test.ts
git commit -m "feat(otp): verifyOtp — spend the code, then issue a session"
```

---

### Task 7: `POST /api/v1/auth/otp/verify`

**Files:**
- Create: `src/app/api/v1/auth/otp/verify/route.ts`
- Test: `tests/integration/auth/otp-verify-route.test.ts`

**Interfaces:**
- Consumes: `verifyOtp`, `VerifyOtpResult` from Task 6
- Produces: `POST` handler answering the login body on `200`, and `400` / `403` / `429` problem documents

- [ ] **Step 1: Write the failing test**

Create `tests/integration/auth/otp-verify-route.test.ts`:

```typescript
/**
 * POST /api/v1/auth/otp/verify — the HTTP shell around verifyOtp.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/services/auth/otp.service', () => ({ verifyOtp: vi.fn() }));

const mockLimiter = {
  check: vi.fn().mockReturnValue({ kind: 'allow' }),
  recordFailure: vi.fn(),
  recordSuccess: vi.fn(),
};
vi.mock('@/lib/rate-limit', () => ({
  createRateLimiter: vi.fn(() => mockLimiter),
  DEFAULT_RATE_LIMIT_CONFIG: {},
  tupleKey: vi.fn((a: string, b: string) => `${a}:${b}`),
}));

const { POST } = await import('@/app/api/v1/auth/otp/verify/route');
const { verifyOtp } = await import('@/services/auth/otp.service');
const { AuthError } = await import('@/services/auth/service');

const SESSION = {
  user: {
    id: 'user-1',
    email: 'budi@example.com',
    username: 'budi',
    firstName: 'Budi',
    lastName: 'Santoso',
    displayName: 'Budi Santoso',
    role: 'CLIENT',
    // BigInt on purpose: JSON.stringify throws on it, so the route must convert.
    wpUserId: BigInt(924),
  },
  accessToken: 'mock-access-token',
  accessTokenExpiresAt: new Date('2026-08-18T01:00:00.000Z'),
  refreshToken: 'mock-refresh-token',
  refreshTokenExpiresAt: new Date('2026-08-25T00:00:00.000Z'),
};

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/v1/auth/otp/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  });
}

const BODY = { email: 'budi@example.com', code: '418902' };

beforeEach(() => {
  vi.clearAllMocks();
  mockLimiter.check.mockReturnValue({ kind: 'allow' });
  vi.mocked(verifyOtp).mockResolvedValue(SESSION as never);
});

describe('POST /api/v1/auth/otp/verify', () => {
  it('returns 200 with the same body shape as /auth/login', async () => {
    const res = await POST(makeReq(BODY));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      user: { id: 'user-1', role: 'CLIENT', wpUserId: 924 },
    });
    expect(typeof json.accessTokenExpiresAt).toBe('string');
  });

  it('rejects a code that is not six digits before calling the service', async () => {
    const res = await POST(makeReq({ ...BODY, code: '12ab' }));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_error');
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('maps invalid_code to 400', async () => {
    vi.mocked(verifyOtp).mockRejectedValue(new AuthError('invalid_code', 400, 'nope'));

    const res = await POST(makeReq(BODY));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_code');
  });

  it('maps code_expired to 400', async () => {
    vi.mocked(verifyOtp).mockRejectedValue(new AuthError('code_expired', 400, 'expired'));

    const res = await POST(makeReq(BODY));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('code_expired');
  });

  it('maps too_many_attempts to 400', async () => {
    vi.mocked(verifyOtp).mockRejectedValue(new AuthError('too_many_attempts', 400, 'burned'));

    const res = await POST(makeReq(BODY));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('too_many_attempts');
  });

  it('maps account_inactive to 403', async () => {
    vi.mocked(verifyOtp).mockRejectedValue(new AuthError('account_inactive', 403, 'inactive'));

    const res = await POST(makeReq(BODY));

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('account_inactive');
  });

  it('returns 429 with Retry-After when guessing is locked out', async () => {
    mockLimiter.check.mockReturnValue({ kind: 'lockout', retryAfterMs: 300_000 });

    const res = await POST(makeReq(BODY));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('300');
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('counts a failed attempt and clears the count on success', async () => {
    vi.mocked(verifyOtp).mockRejectedValue(new AuthError('invalid_code', 400, 'nope'));
    await POST(makeReq(BODY));
    expect(mockLimiter.recordFailure).toHaveBeenCalled();

    vi.clearAllMocks();
    mockLimiter.check.mockReturnValue({ kind: 'allow' });
    vi.mocked(verifyOtp).mockResolvedValue(SESSION as never);
    await POST(makeReq(BODY));
    expect(mockLimiter.recordSuccess).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/integration/auth/otp-verify-route.test.ts --reporter=basic`
Expected: FAIL — `Cannot find module '@/app/api/v1/auth/otp/verify/route'`.

- [ ] **Step 3: Write the route**

Create `src/app/api/v1/auth/otp/verify/route.ts`:

```typescript
/**
 * POST /api/v1/auth/otp/verify
 *
 * Trades a one-time code for a session. Public — no token required.
 *
 * The success body matches POST /api/v1/auth/login exactly, so a client stores the session
 * the same way whichever route it used to sign in.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyOtp } from '@/services/auth/otp.service';
import {
  badRequest,
  forbidden,
  tooManyRequests,
  problemHeaders,
} from '@/lib/problem-details';
import { createRateLimiter, DEFAULT_RATE_LIMIT_CONFIG, tupleKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const INSTANCE = '/api/v1/auth/otp/verify';

/** Guessing protection on top of the per-code attempt counter: the counter stops a single
 *  code being brute-forced, this stops an attacker cycling through fresh codes. */
const limiter = createRateLimiter({ config: DEFAULT_RATE_LIMIT_CONFIG });

const BodySchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const p = badRequest('invalid_body', 'Request body must be valid JSON', INSTANCE);
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    const p = badRequest('validation_error', 'A valid email and a 6-digit code are required', INSTANCE);
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    '0.0.0.0';
  const userAgent = req.headers.get('user-agent') ?? 'unknown';
  const email = parsed.data.email.trim().toLowerCase();

  const key = tupleKey(ip, email);
  const verdict = limiter.check(key);
  if (verdict.kind === 'lockout') {
    const retryAfter = Math.ceil(verdict.retryAfterMs / 1000);
    const p = tooManyRequests('rate_limited', retryAfter, 'Too many attempts', INSTANCE);
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }

  try {
    const result = await verifyOtp({ email, code: parsed.data.code, ip, userAgent });
    limiter.recordSuccess(key);

    // `wpUserId` is a Prisma BigInt, which JSON.stringify cannot serialise — WP user ids
    // are always small integers, so a plain number is safe.
    const { wpUserId, ...userRest } = result.user;
    return NextResponse.json(
      {
        user: { ...userRest, wpUserId: wpUserId == null ? null : Number(wpUserId) },
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
        refreshToken: result.refreshToken,
        refreshTokenExpiresAt: result.refreshTokenExpiresAt.toISOString(),
      },
      { status: 200 },
    );
  } catch (err) {
    limiter.recordFailure(key);

    const code = (err as { code?: string }).code ?? 'unknown';
    const status = (err as { status?: number }).status ?? 500;

    if (code === 'account_inactive') {
      const p = forbidden('account_inactive', 'Account is inactive', INSTANCE);
      return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
    }
    if (status === 400) {
      const p = badRequest(code, (err as Error).message, INSTANCE);
      return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
    }

    console.error('[auth/otp/verify] unexpected error:', err);
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/integration/auth/otp-verify-route.test.ts --reporter=basic`
Expected: `PASS (8) FAIL (0)`

- [ ] **Step 5: Run the whole affected suite**

Run: `npx vitest run tests/integration tests/unit tests/public-booking tests/complete-in-progress --reporter=basic`
Expected: `FAIL (0)`. Anything else is a regression from this work — fix it before committing.

- [ ] **Step 6: Typecheck, build, commit**

```bash
npx tsc --noEmit
npm run build
git add src/app/api/v1/auth/otp/verify/route.ts tests/integration/auth/otp-verify-route.test.ts
git commit -m "feat(otp): POST /api/v1/auth/otp/verify"
```

The build must list `/api/v1/auth/otp/request` and `/api/v1/auth/otp/verify` in its route table.

---

### Task 8: Front-end guide

**Files:**
- Create: `docs/api/OTP-LOGIN-GUIDE.md`

**Interfaces:**
- Consumes: the finished contract from Tasks 5 and 7
- Produces: nothing code depends on

- [ ] **Step 1: Write the guide**

Create `docs/api/OTP-LOGIN-GUIDE.md`, following the structure of `docs/api/PASSWORD-RESET-GUIDE.md`. It must contain:

- The two endpoints, their request bodies, and their success bodies.
- A table of every `code` in the error tables from Tasks 5 and 7, each with a suggested Indonesian message: `validation_error` → "Masukkan email yang valid dan kode 6 angka", `invalid_code` → "Kode salah. Periksa lagi email kamu", `code_expired` → "Kode sudah kedaluwarsa. Minta kode baru", `too_many_attempts` → "Terlalu banyak percobaan. Minta kode baru", `account_inactive` → "Akun kamu tidak aktif. Hubungi klinik", `rate_limited` → "Terlalu sering. Coba lagi dalam beberapa menit".
- That `request` **always** answers `200`, so the UI must not imply whether an address is registered.
- That `retryAfter` in the `200` body is the number of seconds to keep the resend button disabled.
- That the code is 6 digits and the input should accept exactly that; validate the shape client-side so a typo does not spend a server attempt.
- That a code lasts 10 minutes and dies after 5 wrong tries — so the UI should offer "request a new code" on `code_expired` and `too_many_attempts`, not a bare retry.
- The success body naming trap, copied from `PUBLIC-REGISTER.md`: the API returns `accessToken` / `refreshToken` in camelCase, while the cookies middleware reads are `access_token` / `refresh_token`.
- Base URL `https://staging2.praktiqu.com`.

- [ ] **Step 2: Commit**

```bash
git add docs/api/OTP-LOGIN-GUIDE.md
git commit -m "docs(api): OTP login guide for the front-end team"
```

---

## Deploying

Not a task — the deploy runs once the tasks above are merged, and follows
`docs/deploy/2026-08-06-public-self-registration-deploy.md` with one addition.

1. Apply the migration **before** the app that needs it:
   `mysql -u praktiqu_wp580 -p praktiqu_wp580 < prisma/manual/2026-08-18-create-otp-codes.sql`
2. Confirm: `SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='praktiqu_wp580' AND table_name='otp_codes';` → expect 9.
3. `prisma generate` on the server, because the schema changed — the generated client lives in the nodevenv's `node_modules` and ships in neither the tarball nor the plugin. Skipping it makes `prisma.otpCode` undefined at runtime and every OTP request a 500.
4. Build, upload, swap `.next`, restart Passenger.
5. Smoke test from the server, using a `+alias` address so the mail lands in a real inbox:
   request → read the code from the mail → verify → expect `200` and a working token
   against `GET /api/v1/auth/me`.
6. Re-posting the same code must fail with `invalid_code`.

The first request after a Passenger restart can be served by a worker that has not
respawned yet — retry once before believing a failure.
