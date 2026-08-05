# Phase 3.2 — Migrating the professional services off the shadow tables

**Date:** 2026-07-27
**Status:** Prerequisites complete; the service rewrite is the remaining step.
**Parent:** [shadow-tables-audit.md](./shadow-tables-audit.md)

## Why this is one commit

`availability.service.ts` reads `prisma.professional` to check status before generating
slots. If `createProfessional` writes to `wp_users` while availability still reads the
shadow table, a newly created professional generates **no bookable slots at all** — the
same class of failure as the client migration, where new clients became invisible.

All three services and their 15 routes therefore migrate together.

## Prerequisites — done

| Piece | Commit | Tests |
|---|---|---|
| `doctors.repo` + `praktiqu_*` fields, clinic/status/type filters, registration lookup | `01021b0` | 15 |
| `off-days.repo` → `wp_kc_clinic_schedule` | `e00d8af` | 12 |
| Plugin `POST/PUT /doctors` + `doctors.write.ts` | `83ecbe3` | php -l |
| Test schema synced from production (`--reference praktiqu`) | `cdc4dd1` | drift = 0 |

## Mapping

| Shadow table | Target |
|---|---|
| `professionals`, `doctors` | `wp_users` role `kiviCare_doctor` + `praktiqu_*` meta |
| `professional_availability` | `wp_kc_clinic_sessions` (`clinic-sessions.repo.ts`) |
| `professional_off_days` | `wp_kc_clinic_schedule` (`off-days.repo.ts`) |
| `professional_service_assignments` | `wp_kc_service_doctor_mapping` (`services.repo.ts`) |

## The part that needs care: `generateSlots`

Today it returns `[]` if **any** off-day row matches the date. That is wrong against the
real data now that `time_specific` rows exist: a closure covering only 13:00–17:00 would
hide the whole day's morning slots.

`isOffOn` deliberately returns `true` for a time-specific row — the day *is* affected —
so the rewrite must branch:

- off-day with `timeSpecific === false` → no slots that day
- off-day with `timeSpecific === true` → drop only slots overlapping
  `startTime`–`endTime`, keep the rest

Also note availability windows move from `startMinute`/`endMinute` integers to
`HH:MM:SS` strings, and slot duration comes from `wp_kc_clinic_sessions.time_slot`
rather than the service row.

## Order

1. `professional.service.ts` — CRUD, list, status, bulk, export (ids → `number`)
2. `availability.service.ts` — weekly schedule, off days, `generateSlots`
3. `service-assignment.service.ts` — `wp_kc_service_doctor_mapping`
4. 15 routes: `id: string` → parsed integer, with the same NaN guard as clients
5. Register the `professionals` group in `scripts/generate-openapi.ts` — **all** of its
   routes, or the generator silently drops the unregistered ones (see openapi doc)
6. Drop `professionals`, `doctors`, `professional_availability`, `professional_off_days`,
   `professional_service_assignments` via scoped SQL (Phase 4.2)

**Estimate:** ~2 days.
