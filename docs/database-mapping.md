# Database Mapping - KiviCare to PraktiQU

**Project:** PraktiQU - Next.js Clinic Management System (EHR)  
**Document:** Database Mapping  
**Version:** 1.0  
**Date:** 2026-05-22  

---

## Overview

This document maps KiviCare WordPress database table names to PraktiQU entity names (code/UI).

**Architecture note**: PraktiQU does **not** share tables with WordPress. Both systems live on the **same MySQL instance** but use **separate schemas** (`praktiQU` and `wordpress`). Prisma declares its own tables under PraktiQU's schema, and the KiviCare-style table names are preserved via `@@map` for compatibility with existing scripts and tooling. This is a *naming-mapping* document, not a *data-migration* document — there is no plan to copy data out of `wp_*` tables into PraktiQU's own tables.

For cross-system identity flow, PraktiQU reads `wp_users` and `wp_usermeta` directly (WordPress remains the source of truth for credentials and identity); PraktiQU's own `users` table stores a `wpUserId` foreign reference, role mapping, and any PraktiQU-specific fields.

---

## Core Entity Mapping

| KiviCare Table | → | PraktiQU Entity | Notes |
|---------------|----|-----------------|-------|
| `wp_kc_clinics` | → | Clinic | Same table |
| `wp_kc_doctors` | → | Doctor | Same table |
| `wp_kc_patients` | → | Patient | Same table |
| `wp_kc_appointments` | → | Appointment | Same table |
| `wp_kc_patient_encounters` | → | Encounter | Same table |
| `wp_kc_prescriptions` | → | Prescription | Same table |
| `wp_kc_services` | → | Service | Same table |
| `wp_kc_bills` | → | Bill | Same table |
| `wp_kc_bill_items` | → | BillItem | Same table |

---

## Field Naming Conventions

### KiviCare (WordPress Style - Snake_case)
```php
appointment_start_date
doctor_id
patient_id
```

### PraktiQU (TypeScript Style - camelCase)
```typescript
appointmentStartDate
doctorId
patientId
```

---

## API Response Mapping

### Doctor Entity
```typescript
// KiviCare Response (snake_case)
{ id: 123, display_name: "Dr. Smith" }

// PraktiQU Response (camelCase)
{ id: 123, displayName: "Dr. Smith" }
```

### Patient Entity
```typescript
// KiviCare Response
{ id: 456, first_name: "Jane", last_name: "Doe" }

// PraktiQU Response
{ id: 456, firstName: "Jane", lastName: "Doe" }
```

---

## Status Mapping

### Appointment Status
| KiviCare | Value | PraktiQU |
|----------|-------|----------|
| CANCELLED | 0 | CANCELLED |
| BOOKED | 1 | BOOKED |
| PENDING | 2 | PENDING |
| CHECK_OUT | 3 | CHECK_OUT |
| CHECK_IN | 4 | CHECK_IN |

---

*Document Owner: PraktiQU Team*  
*Last Updated: 2026-05-22*