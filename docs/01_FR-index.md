# Functional Requirements Index

**Project:** PraktiQU - Next.js Psychology Practice Management System  
**Document:** FR Index - Functional Requirements  
**Version:** 1.3  
**Date:** 2026-05-22  
**Status:** Draft - For Review  

---

## Overview

This document indexes all Functional Requirements for PraktiQU, adapted for **Psychology Practice Management**.

### Terminology Changes from KiviCare
| KiviCare (Medical) | → | PraktiQU (Psychology) |
|--------------------|---|------------------------|
| Doctor | → | **Professional / Psikolog** |
| Patient | → | **Client / Klien** |
| Appointment | → | **Session / Sesi** |
| Encounter | → | **Session Notes** |
| Prescription | → | **Intervention Plan / Recommendations** |

> **Note:** Prescription table (`wp_kc_prescriptions`) **KEPT** - isinya untuk menulis rekomendasi/activities yang perlu dilakukan client, bukan medication.

---

## Requirement Categories

### FR-01: Authentication & User Management
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01.01 | User registration with email verification | P0 |
| FR-01.02 | User login with credentials | P0 |
| FR-01.03 | Password reset functionality | P0 |
| FR-01.04 | Session management with secure tokens | P0 |
| FR-01.05 | Role-based access control (RBAC) | P0 |
| FR-01.06 | Multi-role user system | P0 |
| FR-01.07 | User profile management | P1 |
| FR-01.08 | Inactive user account handling | P1 |

### FR-02: Professional Management
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-02.01 | Professional registration | P0 |
| FR-02.02 | Professional profile management | P0 |
| FR-02.03 | Professional type assignment (Psikolog Klinis, Psikiater, dll) | P0 |
| FR-02.04 | Professional registration number (SIP/SIK) | P0 |
| FR-02.05 | Professional service association | P1 |
| FR-02.06 | Professional location/clinic assignment | P1 |
| FR-02.07 | Professional availability schedule | P0 |
| FR-02.08 | Day-wise session slot configuration (50 min default) | P0 |
| FR-02.09 | Professional digital signature | P2 |
| FR-02.10 | Professional status management | P1 |
| FR-02.11 | Professional list with search/filter | P0 |

### FR-03: Client Management
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-03.01 | Client registration | P0 |
| FR-03.02 | Client unique ID generation | P1 |
| FR-03.03 | Client profile with demographics | P0 |
| FR-03.04 | Client session history | P1 |
| FR-03.05 | Client clinic registration | P1 |
| FR-03.06 | Client self-registration portal | P1 |
| FR-03.07 | Client status management | P1 |
| FR-03.08 | Client list with pagination | P0 |
| FR-03.09 | Client search by mobile number | P1 |
| FR-03.10 | Client progress tracking | P1 |
| FR-03.11 | Informed consent verification | P1 |

### FR-04: Session Management (Previously: Appointment)
> **Note:** Client books → PENDING → **Professional must approve** → BOOKED

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-04.01 | Create session booking | P0 |
| FR-04.02 | Update session | P0 |
| FR-04.03 | Cancel session | P0 |
| FR-04.04 | Session status workflow | P0 |
| FR-04.05 | Calendar view display | P0 |
| FR-04.06 | Session slot generation (based on service duration) | P0 |
| FR-04.07 | Conflict prevention | P1 |
| FR-04.08 | Auto-close past sessions | P2 |
| FR-04.09 | Session filters | P1 |
| FR-04.10 | Session export (CSV) | P2 |
| FR-04.11 | Session type (Individual/Group/Assessment) | P1 |
| FR-04.12 | Multi-timezone support | P1 |
| FR-04.13 | Session notes integration | P1 |

### FR-05: Service Catalog
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-05.01 | Create service | P0 |
| FR-05.02 | Update service | P0 |
| FR-05.03 | Delete service | P1 |
| FR-05.04 | Service pricing | P0 |
| FR-05.05 | Service duration (flexible per service, e.g., 60, 90, 120 min) | P1 |
| FR-05.06 | Service type (Konseling, Asesmen, Workshop) | P1 |
| FR-05.07 | Private/public service flag | P2 |

### FR-06: Session Notes (Previously: Encounter)
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-06.01 | Create session notes | P1 |
| FR-06.02 | Session notes content | P1 |
| FR-06.03 | Session notes status (open/closed) | P1 |
| FR-06.04 | Session notes template | P2 |
| FR-06.05 | Progress report upload | P2 |
| FR-06.06 | Informed consent tracking | P1 |
| FR-06.07 | Link to session | P1 |
| FR-06.08 | Print session notes | P2 |

### FR-07: Intervention Plan / Recommendations
> **formerly Prescription** - but used for writing recommendations/activities for clients

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-07.01 | Create intervention plan/recommendations | P1 |
| FR-07.02 | Add recommendation details | P1 |
| FR-07.03 | Set frequency/duration | P1 |
| FR-07.04 | Add instructions | P2 |
| FR-07.05 | Intervention plan list | P1 |
| FR-07.06 | Print/download intervention plan | P2 |
| FR-07.07 | View intervention plan (Client access) | P1 |
| FR-07.08 | Link to session notes | P1 |

### FR-08: Informed Consent
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-08.01 | Create consent form | P1 |
| FR-08.02 | Send consent for signature | P1 |
| FR-08.03 | Client digital signature | P0 |
| FR-08.04 | View consent status | P1 |
| FR-08.05 | Withdraw consent | P2 |

### FR-09: Clinic Management
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-09.01 | Create clinic | P0 |
| FR-09.02 | Update clinic details | P0 |
| FR-09.03 | Clinic logo upload | P1 |
| FR-09.04 | Clinic address management | P0 |
| FR-09.05 | Clinic timezone configuration | P1 |
| FR-09.06 | Clinic currency settings | P1 |
| FR-09.07 | Clinic status (active/inactive) | P1 |

### FR-10: Billing & Payments
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-10.01 | Generate bill | P1 |
| FR-10.02 | Bill items management | P1 |
| FR-10.03 | Discount application | P1 |
| FR-10.04 | Invoice generation | P1 |
| FR-10.05 | Invoice print | P1 |
| FR-10.06 | Payment status tracking | P1 |

### FR-11: Communication & Notifications
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-11.01 | Email notification sending | P1 |
| FR-11.02 | Email template customization | P1 |
| FR-11.03 | Session reminders | P1 |
| FR-11.04 | Client welcome email | P2 |

### FR-12: Public Booking Portal
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-12.01 | Public booking page | P0 |
| FR-12.02 | Professional selection | P0 |
| FR-12.03 | Service selection | P0 |
| FR-12.04 | Date/time selection | P0 |
| FR-12.05 | Inline client registration | P1 |
| FR-12.06 | Booking confirmation | P0 |

### FR-13: Dashboard & Reporting
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-13.01 | Dashboard overview | P0 |
| FR-13.02 | Session statistics | P1 |
| FR-13.03 | Active clients count | P1 |
| FR-13.04 | Upcoming sessions widget | P0 |
| FR-13.05 | Calendar integration | P0 |

### FR-14: Scheduling & Holidays
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-14.01 | Clinic schedule management | P1 |
| FR-14.02 | Holiday management | P1 |
| FR-14.03 | Professional off days | P1 |
| FR-14.04 | Display holidays on calendar | P1 |

### FR-15: Settings & Configuration
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-15.01 | General settings | P1 |
| FR-15.02 | Session settings | P1 |
| FR-15.03 | Client settings | P1 |
| FR-15.04 | Email settings | P1 |

### FR-16: Security & Compliance
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-16.01 | End-to-end encryption (E2EE) | P1 |
| FR-16.02 | Session security | P0 |
| FR-16.03 | Input validation | P0 |

---

## Key Adaptations Summary

### Terminology Changes
| KiviCare | → | PraktiQU |
|----------|---|----------|
| Doctor | → | **Professional** |
| Patient | → | **Client** |
| Appointment | → | **Session** |
| Encounter | → | **Session Notes** |
| Prescription | → | **Intervention Plan** (KEPT - untuk rekomendasi) |
| Visit Type | → | **Session Type** |

### Intervention Plan / Recommendations
> Table `wp_kc_prescriptions` **KEPT** - digunakan untuk menulis:
> - Rekomendasi kegiatan/client activities
> - Exercises untuk client
> - Homework/assignments
> - Frequency dan duration
> - Instructions

### Session Duration
- Duration is **based on service** (e.g., 60, 90, 120 minutes)
- Not a fixed default per slot

---

## Priority Legend

| Code | Description |
|------|-------------|
| P0 | Critical - Must have for MVP |
| P1 | High - Important, MVP essential |
| P2 | Medium - Nice to have |

---

*Document Owner: PraktiQU Team*  
*Last Updated: 2026-05-22*