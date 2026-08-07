# Public self-registration — design

**Date**: 2026-08-06
**Status**: Approved, ready for planning
**Related**: `specs/001-auth-foundation/spec.md` FR-022, FR-027; `docs/audits/principal-architect-audit-2026-06-02.md` §residual risk

## Problem

A patient cannot create their own account. Three pieces exist but were never joined:

1. `register()` in `src/services/auth/service.ts` implements FR-022 in full — password-strength
   validation, rate limiting, duplicate check, WP-user-first ordering, audit log — and **no route
   calls it**.
2. `POST /api/v1/auth/register` exists but was repurposed as SUPER_ADMIN-only provisioning. It
   creates a PraktiQU `User` row with no WordPress account, so the user can never log in.
3. `src/app/register/page.tsx` posts a password to that admin-only route, so the page is broken.

The break underneath all of it: `wpRegisterClient()` in `src/lib/auth/wp-auth.ts` calls
`POST /wp-json/praktiqu/v1/users`, a route that was planned in FR-027 but never built in the
`praktiqu-endpoint` plugin. Every call would 404 and surface as `service_unavailable`.

What *does* exist and is deployed: `POST /wp-json/praktiqu/v1/patients`, which accepts an optional
`password`, runs `wp_insert_user` (a real hash, not the placeholder that caused the receptionist
lockout), and fires `kc_patient_save` so KiviCare bookkeeping and Pro custom fields run.

## Decisions

| Decision | Choice |
|---|---|
| Account shape | Full KiviCare patient via the existing `/patients` plugin route. No plugin redeploy. |
| Request fields | `email`, `password`, `firstName`, `lastName`, `contactNumber?`. No clinic. |
| Clinic mapping | Deferred to first booking — `resolvePatient()` already maps a returning patient to the clinic. |
| Response | `201` with auto-login: same token payload as `/auth/login`. Deviates from FR-022 ("no tokens issued"), accepted for booking UX. |
| Scope | Endpoint + fix `src/app/register/page.tsx`. Admin route left untouched. |
| Welcome-email password leak | Accepted (see Accepted risk). |

## API contract

`POST /api/v1/public/auth/register` — new file `src/app/api/v1/public/auth/register/route.ts`.

Request:

```json
{
  "email": "budi@example.com",
  "password": "rahasia123",
  "firstName": "Budi",
  "lastName": "Santoso",
  "contactNumber": "081234567890"
}
```

`contactNumber` is optional; every other field is required.

Success — `201`, body identical in shape to `POST /api/v1/auth/login` plus `userId`, so the
front-end stores the session the same way in both flows:

```json
{
  "userId": "…",
  "user": { "id": "…", "email": "…", "username": "…", "firstName": "…", "lastName": "…",
            "displayName": "…", "role": "CLIENT", "wpUserId": 123 },
  "accessToken": "…",
  "accessTokenExpiresAt": "2026-08-06T…Z",
  "refreshToken": "…",
  "refreshTokenExpiresAt": "2026-08-13T…Z"
}
```

Errors, all `application/problem+json` via `src/lib/problem-details.ts`:

| Status | Code | Cause |
|---|---|---|
| 400 | `validation_error` | Body fails the Zod schema |
| 400 | `weak_password` | Under 8 chars, or missing letters/digits (`validatePasswordStrength`) |
| 409 | `duplicate_email` | Email already on a PraktiQU `User`, or the plugin returns 409 |
| 429 | `rate_limited` | Rate limiter lockout; carries `Retry-After` in seconds |
| 503 | `service_unavailable` | WordPress unreachable or the plugin route missing |

A `409` says only that the address is taken. Whether it belongs to a patient, a doctor, or an
admin is not a stranger's business — the same reasoning as `EmailConflictError` in public booking.

Rate limiting reuses `createRateLimiter` keyed by `tupleKey(ip, email)`, matching
`src/app/api/v1/public/appointments/route.ts`.

## Service changes — `src/services/auth/service.ts`

`register()` keeps its rate limiting, duplicate check, and `audit.register` call. Three changes:

1. **Swap the WordPress call.** `wpRegisterClient()` → `createPatient()` from
   `src/repositories/wp/patients.write.ts`. That module is the single owner of the patient request
   body and is the path public booking already uses; a second implementation of the same shape
   would drift. Map `WpEndpointError` with status 409 to `DuplicateEmailError`, anything else to
   `WpUnavailableError`.
2. **Accept `contactNumber`** on `RegisterInput` and pass it through.
3. **Issue tokens.** After `prisma.user.upsert`, call the existing `issueTokensForUser(user, ip,
   userAgent)` — the same function `login()` uses. No new token-issuing path. Return type becomes
   `{ userId } & IssuedTokens & { user }`.

Supporting change: `WrittenPatient` and `PluginPatientResponse` in `patients.write.ts` gain
`username`. The plugin's `build_payload` already returns it; it was simply not mapped. `User.username`
is required and unique, so the value must come from WordPress rather than being re-derived here.

Removal: `wpRegisterClient()` in `src/lib/auth/wp-auth.ts`, plus the `POST /users` line in that
file's route-list docblock. It points at a WordPress route that does not exist, and leaving it is
an invitation to call it again.

## Front-end — `src/app/register/page.tsx`

- Post to `/api/v1/public/auth/register`.
- Drop the `username` field. The server derives the login name from the email, and the plugin
  guarantees uniqueness through `unique_username()`.
- Add an optional phone-number field mapped to `contactNumber`.
- On `201`, write `access_token` and `refresh_token` cookies from `accessToken` / `refreshToken`,
  then redirect to `/dashboard`.

**Adjacent bug fixed here.** `src/app/login/page.tsx:39-42` reads `data.access_token` and
`data.refresh_token`, but `/api/v1/auth/login` returns `accessToken` and `refreshToken`. The login
page has been writing `access_token=undefined` and never storing a session. Two lines, same flow,
fixed alongside — otherwise the register page would be copied from a broken template.

Middleware needs no functional change: `/api/v1/public/*` matches nothing in `needsAuth`, so it
already passes. `/api/v1/public` is added to `PUBLIC_API_PREFIXES` so that outcome is stated rather
than incidental.

## Testing

Following `tests/public-booking/`:

- Service unit tests with `createPatient` mocked — happy path (patient created, `User` upserted with
  role `CLIENT`, tokens issued), weak password, duplicate email on the PraktiQU side, plugin 409,
  plugin unreachable, rate-limit lockout.
- Route tests asserting each status code and that the `201` body carries both tokens.
- A regression test that the PraktiQU `User` row is created with the `wpUserId` returned by the
  plugin, since a missing link is what makes an account unable to log in.

## Accepted risk

The chosen password is sent to `POST /praktiqu/v1/patients`, which passes it to
`kc_patient_save` as `temp_password`
(`Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-patients.php:324`).
`KCPatientNotificationListener::sendPatientWelcomeNotification`
(`…/kivicare-clinic-management-system/app/emails/listeners/KCPatientNotificationListener.php:103`)
puts it in the welcome email as `user_password` in plaintext.

The alternatives — suppressing the notification listener for this call (needs a plugin redeploy) or
letting WordPress generate a throwaway password and immediately changing it (two non-atomic calls,
and the patient receives an email with a password that no longer works) — were considered and
declined in favour of shipping the single-call version.

Closable later without touching code by disabling the `patient_register` email template in
KiviCare's settings.

## Out of scope

- Email verification / double opt-in.
- CAPTCHA. IP+email rate limiting is the only abuse control.
- Self-registration for any role other than `CLIENT`.
- The `onClientRegistered()` notification hook from `specs/012-notifications` (not implemented in
  `src/`; the KiviCare welcome email is the only welcome mail today).
- Reclaiming `POST /api/v1/auth/register` for public use, or relocating the admin provisioning route.
