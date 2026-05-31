# Product Requirements Document (PRD)

**Project:** PraktiQU - Next.js Psychology Practice Management System  
**Document:** PRD Index  
**Version:** 1.1  
**Date:** 2026-05-22  

---

## Overview

This PRD describes the product requirements for PraktiQU, a standalone Next.js application adapted for **Psychology Practice Management**.

---

## User Roles

| Role | Description | Access Level |
|------|-------------|--------------|
| Super Admin | System administrator with full access | All modules, all practices |
| Clinic Admin | Manages a clinic | Assigned clinic |
| Professional | Psychologist/Psychiatrist | Assigned clients, sessions |
| Receptionist | Front desk operations | Sessions, client registration |
| Client | Self-service portal | Own records, self-booking |

---

## Core Features Summary

### Phase 1: MVP (Must Have)

| Module | Features | Priority |
|--------|----------|----------|
| Authentication | Login, Register, Password Reset, RBAC | P0 |
| Professional | CRUD, Profile, SIP/SIK, Specialties | P0 |
| Client | CRUD, Unique ID, Registration, Consent | P0 |
| Service | CRUD, Pricing, Duration (flexible) | P0 |
| Session | **Booking Request → Approval Flow**, Calendar, Status | P0 |
| Dashboard | Statistics, Overview, Upcoming Sessions | P0 |
| Public Booking | Professional/Service Selection, Date/Time | P0 |

### Phase 2: Core Features

| Module | Features | Priority |
|--------|----------|----------|
| Session Notes | Visit Tracking, Clinical Notes | P1 |
| Intervention Plan | Recommendations for clients | P1 |
| Informed Consent | Digital consent forms | P1 |
| Billing | Invoice, Payments | P1 |
| Notifications | Email Templates, Reminders, **Approval Notifications** | P1 |
| Custom Fields | Dynamic Forms | P2 |

---

## Key Workflow Changes

### Session Booking Flow
```
Client books → PENDING → Professional approves → BOOKED → CHECK_IN → CHECK_OUT → COMPLETED
                ↓
             REJECTED
```

> **Note:** Professional must approve/reject session requests before confirmation.

### Session Duration
> Session duration is based on **service type**, not a fixed default.
> - Konseling Individual: 60 min
> - Konseling Kelompok: 90 min
> - Asesmen Psikologis: 120 min

---

## References

- [KiviCare WordPress Plugin](https://kivicare.io)
- [KiviCare Documentation](https://documentation.iqonic.design/kivicare-wordpress)