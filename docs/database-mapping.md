# Database Mapping - KiviCare to PraktiQU

**Project:** PraktiQU - Next.js Clinic Management System (EHR)  
**Document:** Database Mapping  
**Version:** 1.0  
**Date:** 2026-05-22  

---

## Overview

This document maps KiviCare WordPress database table names to PraktiQU entity names (code/UI). Since PraktiQU will use the **existing KiviCare database**, we need to maintain backward compatibility while providing a clean mapping for the new application code.

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