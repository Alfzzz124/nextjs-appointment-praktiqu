# Product Requirements Document (PRD)

**Project:** PraktiQU - Next.js Clinic Management System (EHR)  
**Document:** PRD Index  
**Version:** 1.0  
**Date:** 2026-05-22  

---

## Overview

This PRD describes the product requirements for PraktiQU, a standalone Next.js application that replicates and improves upon the KiviCare WordPress plugin functionality.

---

## User Roles

| Role | Description | Access Level |
|------|-------------|--------------|
| Super Admin | System administrator with full access | All modules, all clinics |
| Clinic Admin | Manages a single clinic | Assigned clinic only |
| Doctor | Medical professional | Assigned patients, appointments |
| Receptionist | Front desk operations | Appointments, patient registration |
| Patient | End user | Own records, self-booking |

---

## Core Features Summary

### Phase 1: MVP (Must Have)

| Module | Features | Priority |
|--------|----------|----------|
| Authentication | Login, Register, Password Reset, RBAC | P0 |
| Clinic | CRUD, Logo, Address, Contact | P0 |
| Doctor | CRUD, Profile, Specialties, Services | P0 |
| Patient | CRUD, Unique ID, Registration | P0 |
| Appointment | Calendar, Booking, Status Workflow | P0 |
| Service | CRUD, Pricing, Doctor Mapping | P1 |
| Dashboard | Statistics, Overview | P1 |
| Public Booking | Doctor/Services Selection, Date/Time | P0 |

### Phase 2: Core Features

| Module | Features | Priority |
|--------|----------|----------|
| Encounter | Visit Tracking, Clinical Notes | P1 |
| Prescription | Medication Orders | P1 |
| Billing | Invoice, Payments | P1 |
| Notifications | Email Templates, Reminders | P1 |
| Custom Fields | Dynamic Forms | P2 |
| Reports | Revenue, Appointments | P2 |

---

## References

- [KiviCare WordPress Plugin](https://kivicare.io)
- [KiviCare Documentation](https://documentation.iqonic.design/kivicare-wordpress)