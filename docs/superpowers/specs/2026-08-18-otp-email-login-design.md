# Login via OTP email — design

**Date**: 2026-08-18
**Status**: Approved, ready for planning
**Related**: `specs/001-auth-foundation/spec.md` FR-001 (login), FR-027 (WordPress owns credentials)

## Problem

Users and the front-end team want to sign in with a one-time code emailed to them, instead
of typing a password.

Nothing like it exists: `grep -r otp src/ prisma/` returns nothing. What does exist and can
be reused is most of the machinery — `PasswordResetToken` is the same shape a one-time code
needs, `sendEmail()` delivers through Resend and is proven in production, `createRateLimiter`
is already applied to every other auth route, and `ensureUserFromWordPress()` resolves an
email to a user even for the ~789 accounts that have never logged into the app.

## Decisions

| Decision | Choice |
|---|---|
| Relationship to password login | **Additional**, not a replacement. Password login is untouched. |
| Who can use it | **Every role**, including SUPER_ADMIN and PROFESSIONAL. |
| Code shape | 6 digits, valid 10 minutes |
| Wrong-code limit | 5 attempts, then the code is dead |
| Resend cooldown | 60 seconds; max 5 requests per 15 minutes per (IP, email) |
| Storage | A dedicated `otp_codes` table, not a column on `users` |

### Why not a column on `users`

The original suggestion was an OTP column on the user row. Rejected for three reasons:

1. **Nowhere to put `usedAt` or an attempt counter.** A 6-digit code has a million
   possibilities; without a per-code attempt cap it is brute-forceable. A single column
   cannot record "already used" or "wrong five times".
2. **A live credential sitting in the profile row.** Every query that reads `users` for
   unrelated reasons would carry a working credential in its result set.
3. **Schema churn on a shared database.** `users` lives in the same database as KiviCare's
   tables. Any change there is a hand-written, scoped statement — see the migration section.

## Data

```prisma
model OtpCode {
  id        String    @id @default(cuid())
  userId    String
  codeHash  String              // SHA-256 of the 6 digits — never the code itself
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

Deliberately mirrors `PasswordResetToken`, with **one difference that matters**: `codeHash`
is **not unique**. A reset token is 32 random bytes, so marking it unique is safe. Six digits
will collide between users sooner rather than later, and a unique index would turn that
collision into a failed login for whoever came second.

Lookup is therefore by `userId`, taking the newest row where `usedAt IS NULL` and
`expiresAt > now()`, then comparing hashes. That is also what makes a per-code attempt
counter possible.

## Endpoints

Both live under `/api/v1/auth/`, alongside `login` and `forgot-password`, and both are public.
`/api/v1/auth/otp` is added to `PUBLIC_API_PREFIXES` in `src/middleware.ts`.

### `POST /api/v1/auth/otp/request`

```json
{ "email": "budi@example.com" }
```

Always answers `200`:

```json
{ "message": "If that email exists, a code has been sent.", "retryAfter": 60 }
```

`retryAfter` drives the front-end countdown. The response never reveals whether the address
is registered — the same no-enumeration rule `forgot-password` follows.

Steps:

1. Rate limit on `(ip, email)`.
2. `ensureUserFromWordPress(email)`. Using this rather than `prisma.user.findUnique` is
   deliberate: most accounts have no `users` row until their first app login, and skipping
   this would recreate the bug that left 789 of 850 staging users unable to reset a password.
3. No user in WordPress either → return the same `200`, send nothing.
4. A code requested less than 60 seconds ago → return the same `200` with the remaining
   seconds in `retryAfter`, send nothing. Silent, so the cooldown cannot be used to probe
   which addresses exist.
5. Mark any live codes for that user used, so only the newest works.
6. `crypto.randomInt(0, 1_000_000)` zero-padded to 6 digits; store the SHA-256, expiry 10
   minutes out, plus IP and user agent.
7. Send via `buildOtpEmail()`.

### `POST /api/v1/auth/otp/verify`

```json
{ "email": "budi@example.com", "code": "418902" }
```

`200` returns exactly the payload `POST /api/v1/auth/login` returns, so the front-end stores
a session identically for both routes.

| HTTP | `code` | Cause |
|---|---|---|
| `400` | `validation_error` | Malformed body, or a code that is not 6 digits |
| `400` | `invalid_code` | Wrong code, unknown email, or no live code |
| `400` | `code_expired` | The code passed its 10 minutes |
| `400` | `too_many_attempts` | Five wrong guesses against this code |
| `403` | `account_inactive` | `status = 0` |
| `429` | `rate_limited` | Carries `Retry-After` in seconds |

An unknown email answers `invalid_code`, never "user not found" — otherwise verify becomes
the enumeration oracle that request refuses to be.

Steps: rate limit → find the user → newest live code → `attempts >= 5` rejects → compare with
`crypto.timingSafeEqual` → on mismatch increment `attempts` and reject → on match set
`usedAt`, run the existing `ensureUserActive`, set `emailVerified` if still null, and issue
tokens through `issueTokensForUser`, the same function `login()` uses.

## What this does NOT change

- **The audit enum is untouched.** `audit.loginSuccess` already carries a `method` field;
  widening its TypeScript union from `'password' | 'google'` to include `'otp'` is the whole
  change. Adding an `AuditEventType` value would have meant an `ALTER TABLE` on a shared
  database, for no benefit.
- **Password login, `forgot-password`, and `reset-password`** are not modified.
- **WordPress** is not called during verify. It is called during request, only to resolve who
  the address belongs to.

## Email

`buildOtpEmail()` in `src/lib/email.ts`, next to `buildPasswordResetEmail()`. The code goes in
the subject line as well as the body, so it is readable from a notification without opening
the mail. The template lives in code and in version control — deliberately not a KiviCare
template, which is how a plaintext password ended up in the registration mail.

## Migration

One hand-written `CREATE TABLE otp_codes`, applied with scoped SQL. **Not `prisma db push` or
`migrate dev`**: this database holds the app's tables and KiviCare's side by side, and Prisma
would try to reconcile the `wp_kc_*` half it does not know about. Same procedure used for
`payment_orders`.

Expired rows are harmless but accumulate; a periodic `DELETE FROM otp_codes WHERE expiresAt <
NOW() - INTERVAL 7 DAY` is enough, and is not part of this work.

## Accepted risk

OTP is available to every role, so for a SUPER_ADMIN or PROFESSIONAL **control of the inbox
becomes equivalent to control of the password**. Password login at least requires a secret
WordPress verifies; this path requires only mail access. That was a deliberate choice for
uniformity. Narrowing it later to `CLIENT` is a single condition in verify.

Partly offsetting it: codes are hashed at rest, die after five wrong guesses, expire in ten
minutes, and the send rate is capped per (IP, email).

## Testing

Service-level, with `sendEmail` mocked, following `tests/integration/auth/`:

- correct code returns tokens and marks `usedAt`
- wrong code increments `attempts` and returns `invalid_code`
- the fifth wrong guess kills the code — a later correct entry still fails
- an expired code returns `code_expired`
- a used code cannot be replayed
- requesting twice inside 60 seconds sends only one mail
- a new request invalidates the previous code
- an unknown email sends nothing and still answers `200`
- an inactive account is rejected after the code matches, not before
- two users holding the same 6 digits do not interfere — the collision case the missing
  unique index exists for

## Out of scope

- SMS or WhatsApp delivery. Email only.
- OTP as a second factor on top of password. This is an alternative, not an addition to one login.
- Front-end pages. A guide for the front-end team ships with the implementation, in the shape
  of `docs/api/PASSWORD-RESET-GUIDE.md`.
- Cleaning up expired rows on a schedule.
