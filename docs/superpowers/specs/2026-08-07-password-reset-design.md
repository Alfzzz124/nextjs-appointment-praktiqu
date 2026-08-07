# Password reset — design

**Date**: 2026-08-07
**Status**: Approved, ready for implementation
**Related**: `specs/001-auth-foundation/spec.md` FR-004, FR-005, FR-006

## Problem

The forgot-password flow is a dead end. `POST /api/v1/auth/forgot-password` is fully
implemented — it mints a 32-byte token, stores the SHA-256 hash with a 30-minute expiry, and
mails a link — but the link goes to `/reset-password?token=…`, and
`POST /api/v1/auth/reset-password` is a stub returning `501 NOT_IMPLEMENTED`. A user can ask for
a reset, receive the mail, click it, and get nowhere.

Everything the second half needs already exists: the `PasswordResetToken` model (unique
`tokenHash`, `expiresAt`, `usedAt`, `ipAddress`, `userAgent`), `wpChangePassword()`, and the
`audit.passwordResetComplete` helper.

## Decisions

| Decision | Choice |
|---|---|
| Path | Keep `POST /api/v1/auth/reset-password`. Already public in middleware, already in the access guide. |
| Response | `200` with a message. No tokens — the user signs in again. |
| Error granularity | Distinguish `invalid_token`, `token_expired`, `token_used`. |
| Front-end pages | Out of scope. A written guide is produced for the front-end team instead. |
| Adjacent fix | Add rate limiting to `forgot-password`, which currently has none. |

## Endpoint

```
POST /api/v1/auth/reset-password
Content-Type: application/json

{ "token": "<raw token from the email link>", "password": "<new password>" }
```

No email field: the token identifies the user.

Success — `200`:

```json
{ "message": "Password updated. Please sign in." }
```

Errors, `application/problem+json`:

| Status | `code` | Cause |
|---|---|---|
| 400 | `invalid_body` | Body is not valid JSON |
| 400 | `validation_error` | `token` or `password` missing |
| 400 | `weak_password` | Under 8 chars, or missing letters/digits |
| 400 | `invalid_token` | No token matches that hash |
| 400 | `token_expired` | Past `expiresAt` |
| 400 | `token_used` | `usedAt` is already set |
| 429 | `rate_limited` | Rate limiter lockout; carries `Retry-After` |
| 503 | `service_unavailable` | WordPress unreachable, or the user has no `wpUserId` |

Separating `invalid` / `expired` / `used` lets the front-end say something useful and offer a
fresh link. It leaks nothing: anyone guessing at a random 32-byte token only ever sees
`invalid_token`; the other two require holding a real token.

## Service — `resetPassword()` in `src/services/auth/service.ts`

A new function beside `login()`, `register()`, and `changePassword()`.

1. `validatePasswordStrength(password)` **first**, before touching the database, so a weak
   password does not burn the token.
2. SHA-256 the incoming token and look it up by `tokenHash` (already unique). Matching on the
   hash mirrors how `forgot-password` stored it — the raw value is never persisted.
3. Reject when `usedAt` is set (`token_used`) or `expiresAt` has passed (`token_expired`).
4. Load the user. No `wpUserId` means no WordPress account to change a password on → treat as
   `service_unavailable`, the same way `changePassword()` does.
5. `wpChangePassword(user.wpUserId, password)`. WordPress stays the sole owner of credentials.
6. **Only after WordPress succeeds**, set `usedAt = now()`. If WordPress fails, the token stays
   valid and the user can retry with the same link rather than being sent back to square one.
7. Revoke every `ACTIVE` refresh token for the user, exactly as `changePassword()` does. A reset
   must evict other sessions — that is the point when an account has been taken over.
8. `audit.passwordResetComplete({ userId, timestamp, ip })`.

Returns nothing but success. No tokens are issued.

## Rate limiting

`reset-password` is limited per **IP** — the attacker is guessing tokens, not emails, so the
email is not part of the key. Uses `createRateLimiter` with `DEFAULT_RATE_LIMIT_CONFIG`, the same
mechanism as the public routes.

`forgot-password` gains a limiter keyed by **(IP, email)**. It has none today, so anyone can
hammer it to flood a person's inbox — and because each request invalidates the previous token,
repeated calls also keep breaking any link the victim is trying to use. The endpoint must keep
answering `200` regardless, so a lockout returns `429` only to the caller that tripped it; the
no-enumeration guarantee is unaffected because the response never depended on whether the email
existed.

## Front-end guide

`docs/api/PASSWORD-RESET-GUIDE.md`, for the team building the pages. Covers: the two pages
(`/forgot-password`, `/reset-password`), request and response contracts for both endpoints,
reading `token` from the query string, what to display for each error `code`, the password rules
to validate client-side so the user is not bounced by the server, and a warning that
`forgot-password` always answers `200` — the UI must not hint at whether an address is
registered.

## Testing

Following `tests/integration/auth/`, with `wpChangePassword` and Prisma mocked:

- Happy path: password changed in WordPress, token marked used, refresh tokens revoked, `200`.
- Unknown token → `invalid_token`, and WordPress is never called.
- Expired token → `token_expired`.
- Already-used token → `token_used`.
- Weak password → `weak_password`, and the token is **not** consumed.
- WordPress failure → `503`, and the token is **not** consumed — the regression that matters,
  since burning the token on a transient failure strands the user.
- Rate-limit lockout → `429`.

## Out of scope

- The front-end pages themselves.
- `RESEND_API_KEY` on staging. Without it `sendEmail` only logs to the console, so no reset mail
  actually reaches anyone there. This blocks end-to-end use but is environment configuration,
  not code.
- Any change to `forgot-password` beyond the rate limiter.
