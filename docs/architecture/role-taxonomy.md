# Role Taxonomy

**File**: `docs/architecture/role-taxonomy.md`
**Status**: Canonical
**Date**: 2026-06-02

## Source of Truth

- **Canonical role names** are stored in Prisma's `UserRole` enum (`prisma/schema.prisma`) and in this document.
- **Canonical action × role matrix** is defined below.
- All other documents (PRD, BRD, feature specs) must derive from this document.
- Deviations require an ADR in `docs/architecture/adr/`.

---

## PraktiQU Canonical Roles

| Canonical (PraktiQU) | WordPress role slug | WP prefix | Notes |
| --- | --- | --- | --- |
| `SUPER_ADMIN` | `administrator` | — | Core WordPress admin (not KiviCare) |
| `CLINIC_ADMIN` | `kiviCare_clinic_admin` | KIVI_CARE_PREFIX | Manages one practice |
| `PROFESSIONAL` | `kiviCare_doctor` | KIVI_CARE_PREFIX | Psychologist / Psychiatrist |
| `RECEPTIONIST` | `kiviCare_receptionist` | KIVI_CARE_PREFIX | Front desk |
| `CLIENT` | `kiviCare_patient` | KIVI_CARE_PREFIX | End user / patient |

### Naming Conventions

- Use **PraktiQU canonical names** in all code, API responses, UI labels, and user-facing strings.
- Use **raw WP slugs** only when writing to `wp_usermeta`, `kivicare_user_role`, or reading WP capability checks.
- The `User.wpRole` column in Prisma stores the raw WP slug for audit logging and cross-system compatibility.

### WordPress Prefix

`KIVI_CARE_PREFIX = "kiviCare_"` (from `kivicare-clinic-management-system.php:45`).

---

## Role Capability Matrix

### v1 Constraints

- **One professional = one practice** (v1 hard constraint). Multi-practice membership is deferred to v2.
- **Per-practice access**: CLINIC_ADMIN, PROFESSIONAL, and RECEPTIONIST all scope their data to the practice they are assigned to. See `PatientClinicMapping`, `DoctorClinicMapping`, `ReceptionistClinicMapping`.
- **Super Admin**: always global access (all practices).

### Action × Role Matrix

| Action | SUPER_ADMIN | CLINIC_ADMIN | PROFESSIONAL | RECEPTIONIST | CLIENT |
| --- | :---: | :---: | :---: | :---: | :---: |
| **Auth** |||||||
| `auth.login` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `auth.register` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `auth.forgot-password` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `auth.reset-password` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `auth.change-password` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `auth.logout` | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Users** |||||||
| `user.create` | ✓ | ✓ | | | |
| `user.read` (own) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `user.read` (practice) | ✓ | ✓ | | ✓ | |
| `user.read` (global) | ✓ | | | | |
| `user.update` (own) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `user.update` (others) | ✓ | ✓ | | | |
| `user.change-role` | ✓ | | | | |
| `user.deactivate` | ✓ | ✓ | | | |
| `user.delete` | ✓ | | | | |
| **Audit** |||||||
| `audit.read` | ✓ | | | | |
| **Practice / Clinic** |||||||
| `practice.create` | ✓ | | | | |
| `practice.read` (own) | ✓ | ✓ | ✓ | ✓ | |
| `practice.update` | ✓ | ✓ | | | |
| `practice.delete` | ✓ | | | | |
| `practice.holiday.create` | ✓ | ✓ | | | |
| `practice.holiday.read` | ✓ | ✓ | ✓ | ✓ | |
| **Professional** |||||||
| `professional.create` | ✓ | | | | |
| `professional.read` | ✓ | ✓ | ✓ | ✓ | |
| `professional.update` (own) | ✓ | ✓ | ✓ | | |
| `professional.update` (others) | ✓ | ✓ | | | |
| `professional.assign-service` | ✓ | ✓ | | | |
| `professional.deactivate` | ✓ | ✓ | | | |
| `professional.schedule.read` | ✓ | ✓ | ✓ | ✓ | |
| `professional.schedule.write` | ✓ | ✓ | ✓ | | |
| `professional.offday.write` | ✓ | ✓ | ✓ | | |
| **Client** |||||||
| `client.create` (staff) | ✓ | ✓ | ✓ | ✓ | |
| `client.create` (self) | | | | | ✓ |
| `client.read` (own) | | | | | ✓ |
| `client.read` (assigned) | ✓ | ✓ | ✓ | | |
| `client.read` (practice) | ✓ | ✓ | | ✓ | |
| `client.read` (global) | ✓ | | | | |
| `client.update` (own) | | | | | ✓ |
| `client.update` (others) | ✓ | ✓ | ✓ | ✓ | |
| `client.deactivate` | ✓ | ✓ | | | |
| `client.progress.read` | ✓ | ✓ | ✓ | | |
| **Service** |||||||
| `service.create` | ✓ | ✓ | | | |
| `service.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `service.update` | ✓ | ✓ | | | |
| `service.delete` | ✓ | ✓ | | | |
| `service.assign` | ✓ | ✓ | | | |
| **Session / Appointment** |||||||
| `session.book` (client self) | | | | | ✓ |
| `session.book` (staff) | ✓ | ✓ | ✓ | ✓ | |
| `session.read` (own) | | | | | ✓ |
| `session.read` (assigned) | ✓ | ✓ | ✓ | | |
| `session.read` (practice) | ✓ | ✓ | | ✓ | |
| `session.read` (global) | ✓ | | | | |
| `session.approve` | ✓ | ✓ | ✓ | | |
| `session.reject` | ✓ | ✓ | ✓ | | |
| `session.check-in` | ✓ | ✓ | | ✓ | |
| `session.check-out` | ✓ | ✓ | | ✓ | |
| `session.cancel` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `session.reschedule` | ✓ | ✓ | ✓ | ✓ | |
| `session.update` | ✓ | ✓ | ✓ | | |
| **Session Notes** |||||||
| `session-notes.create` | | | ✓ | | |
| `session-notes.read` (own) | | | ✓ | | |
| `session-notes.read` (assigned client) | | | ✓ | | |
| `session-notes.read` (practice) | ✓ | ✓ | | | |
| `session-notes.update` (own, not completed) | | | ✓ | | |
| `session-notes.close` | | | ✓ | | |
| `session-notes.print` | | | ✓ | | |
| **Informed Consent** |||||||
| `consent-template.create` | ✓ | ✓ | | | |
| `consent-template.read` | ✓ | ✓ | ✓ | ✓ | |
| `consent.send` | | | ✓ | ✓ | |
| `consent.sign` | | | | | ✓ |
| `consent.read` (own) | | | | | ✓ |
| `consent.read` (practice) | ✓ | ✓ | ✓ | | |
| **Intervention Plan** |||||||
| `intervention-plan.create` | | | ✓ | | |
| `intervention-plan.read` (own) | | | | | ✓ |
| `intervention-plan.read` (assigned) | | | ✓ | | |
| `intervention-plan.update` | | | ✓ | | |
| `intervention-plan.print` | | | ✓ | | |
| **Billing** |||||||
| `billing.create` | ✓ | ✓ | | ✓ | |
| `billing.read` (own) | | | | | ✓ |
| `billing.read` (practice) | ✓ | ✓ | | ✓ | |
| `billing.update` | ✓ | ✓ | | ✓ | |
| `billing.invoice.print` | ✓ | ✓ | | ✓ | |
| `billing.discount` | ✓ | ✓ | | ✓ | |
| `billing.refund` | ✓ | ✓ | | | |
| `billing.configure` | ✓ | | | | |
| **Notifications / Email** |||||||
| `notification-template.read` | ✓ | ✓ | ✓ | ✓ | |
| `notification-template.write` | ✓ | ✓ | | | |
| `notification.send` | | | ✓ | ✓ | |
| **Dashboard** |||||||
| `dashboard.read` (role-specific) | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Settings** |||||||
| `settings.general.read` | ✓ | ✓ | | | |
| `settings.general.write` | ✓ | | | | |
| `settings.session.write` | ✓ | ✓ | | | |
| `settings.email.write` | ✓ | ✓ | | | |

---

## Implementation

- **Role constants**: `src/lib/auth/role-mapping.ts` — `wpRole → PraktiQU` mapping
- **Authorization service**: `src/services/authorization.ts` — implements the matrix above
- **Prisma enum**: `prisma/schema.prisma` — `UserRole` enum

---

## Future: Per-Practice Role Scoping (v2)

Currently, a user has one PraktiQU role globally. In v2, a user may belong to multiple practices with potentially different roles per practice (e.g., a professional working at two clinics). The v2 model will introduce `UserPracticeRole` join table. The matrix above remains valid per `(userId, practiceId)` tuple.
