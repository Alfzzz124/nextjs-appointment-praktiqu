# PraktiQU - KiviCare Next.js Migration Project (Psychology Practice)

## Overview

This document captures the project to clone/recreate the KiviCare WordPress plugin as a standalone Next.js application, **adapted for Psychology Practice Management**.

**Source**: KiviCare Clinic & Patient Management System (EHR) v4.4.0
**Target**: PraktiQU - Next.js Psychology Practice Management System

---

## Terminology Adaptation

| KiviCare (Medical) | → | PraktiQU (Psychology) |
|--------------------|---|------------------------|
| Doctor | → | **Professional / Psikolog** |
| Patient | → | **Client / Klien** |
| Prescription | → | **Intervention Plan** (optional, non-medication) |
| Clinical Notes | → | **Session Notes / Catatan Konseling** |
| Vital Signs | → | **Optional (Mood Scale)** |
| Encounter | → | **Session Notes** |
| Appointment | → | **Session / Sesi** |

---

## Key Adaptations

### 1. Terminology Changes
- Doctor → Professional (Psikolog, Psikiater)
- Patient → Client (Klien)
- Appointment → Session (Sesi)
- Encounter → Session Notes (Catatan Konseling)

### 2. Session Duration
- Default changed from 15-30 minutes → **50-60 minutes** (standard psychology session)

### 3. Prescription System
- Removed medical prescriptions (Psikolog tidak bisa prescribe medication)
- Replaced with Intervention Plan (psychological recommendations, exercises)

### 4. Informed Consent
- New feature: Informed Consent tracking (mandatory before first session)
- Required for psychology practice compliance

### 5. Session Types
- Individual Counseling (Konseling Individual)
- Group Counseling (Konseling Kelompok)
- Psychological Assessment (Asesmen Psikologis)

---

## User Roles

| KiviCare Role | → | PraktiQU Role |
|--------------|---|---------------|
| Doctor | → | **Professional** (Psikolog/Psikiater) |
| Patient | → | **Client** |
| Clinic Admin | → | **Practice Admin** |

### Role Descriptions

| Role | Description | Access Level |
|------|-------------|--------------|
| Super Admin | System administrator | All modules, all practices |
| Practice Admin | Manages a psychology practice | Assigned practice |
| Professional | Psychologist/Psychiatrist | Assigned clients, sessions |
| Receptionist | Front desk operations | Sessions, client registration |
| Client | Self-service portal | Own records, self-booking |

---

## Professional Types

| Type | Description |
|------|-------------|
| Psikolog Klinis | Clinical Psychologist |
| Psikiater | Psychiatrist |
| Psikolog Pendidikan | Educational Psychologist |
| Psikolog Industri & Organisasi | Industrial/Organizational Psychologist |
| Psikolog Anak & Remaja | Child & Adolescent Psychologist |
| Psikolog Forensik | Forensic Psychologist |

---

## Key Modules

### 1. Professional Management
- Profile with registration number (SIP/SIK)
- Professional types assignment
- Availability scheduling
- Day-wise session slots (50 min default)

### 2. Client Management
- Client registration with unique ID
- Session history tracking
- Informed consent verification
- Progress tracking

### 3. Session Management
- Calendar-based booking
- Session types: Individual, Group, Assessment
- Status workflow: Pending → Booked → Check-in → Check-out → Completed
- Conflict prevention
- Session notes per session

### 4. Intervention Plans
- Non-medication recommendations
- Psychological exercises
- Treatment goals
- Duration and frequency

### 5. Informed Consent
- Digital consent forms
- Signature tracking
- Withdrawal capability

### 6. Session Notes
- Professional documentation
- Template support
- Progress reports
- Link to sessions

---

## Database Schema Adaptations

### Tables That Change Name (Conceptual)
| KiviCare | → | PraktiQU |
|----------|---|----------|
| `wp_kc_doctors` | → | Professional |
| `wp_kc_patients` | → | Client |
| `wp_kc_appointments` | → | Session |
| `wp_kc_patient_encounters` | → | Session Notes |

### Tables That Are Removed
| KiviCare | Reason |
|----------|--------|
| `wp_kc_prescriptions` | Not applicable (no medication prescription) |

### New Tables
| Table | Purpose |
|-------|---------|
| `informed_consent` | Consent form management |
| `client_consent_signatures` | Track client consent signatures |

---

## References

- [KiviCare WordPress Plugin](https://kivicare.io)
- [KiviCare Documentation](https://documentation.iqonic.design/kivicare-wordpress)
- Psychology practice management best practices