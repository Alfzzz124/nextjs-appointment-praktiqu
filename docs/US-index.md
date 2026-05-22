# User Stories Index

**Project:** PraktiQU - Next.js Psychology Practice Management System  
**Document:** US Index - User Stories  
**Version:** 1.3  
**Date:** 2026-05-22  
**Status:** Draft - For Review  

---

## Overview

This document indexes all User Stories adapted for **Psychology Practice Management**.

### Terminology Adaptation
| KiviCare | → | PraktiQU |
|----------|---|----------|
| Doctor | → | **Professional** |
| Patient | → | **Client** |
| Appointment | → | **Session** |
| Encounter | → | **Session Notes** |
| Prescription | → | **Intervention Plan / Recommendations** |

> **Note:** Prescription table **KEPT** - digunakan untuk menulis rekomendasi/activities untuk client.

---

## User Story Format

```
User Story ID: US-XX.XX
Title: [Short descriptive title]
As a: [User role]
I want to: [Goal]
So that: [Benefit/Motivation]

Acceptance Criteria:
- [ ] [Criterion 1]
- [ ] [Criterion 2]

Priority: P0/P1/P2
```

---

## User Stories by Module

### US-01: Authentication & Authorization
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-01.01 | Register new user account | Client | P0 |
| US-01.02 | Login to system | All Users | P0 |
| US-01.03 | Reset forgotten password | All Users | P0 |
| US-01.04 | Logout from system | All Users | P0 |
| US-01.05 | View role-based dashboard | All Users | P0 |
| US-01.06 | Manage profile information | All Users | P1 |

### US-02: Practice Management (Previously: Clinic)
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-02.01 | Set up practice profile | Super Admin | P0 |
| US-02.02 | Update practice information | Practice Admin | P0 |
| US-02.03 | Upload practice logo | Practice Admin | P1 |
| US-02.04 | Configure practice schedule | Practice Admin | P1 |
| US-02.05 | Set practice timezone | Practice Admin | P1 |
| US-02.06 | Manage holidays | Practice Admin | P1 |

### US-03: Professional Management (Previously: Doctor)
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-03.01 | Register as professional | Super Admin | P0 |
| US-03.02 | Complete professional profile | Professional | P0 |
| US-03.03 | Set professional type | Professional | P0 |
| US-03.04 | Enter registration number (SIP/SIK) | Professional | P0 |
| US-03.05 | Set specialties | Professional | P1 |
| US-03.06 | Configure availability | Professional | P0 |
| US-03.07 | Set day-wise schedule (based on service duration) | Professional | P0 |
| US-03.08 | View professional list | Practice Admin | P0 |
| US-03.09 | Update professional status | Practice Admin | P1 |

### US-04: Client Management (Previously: Patient)
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-04.01 | Register as client | Client | P0 |
| US-04.02 | Complete client profile | Client | P0 |
| US-04.03 | Add client by staff | Receptionist | P0 |
| US-04.04 | Search clients | Staff | P0 |
| US-04.05 | View client details | Staff | P0 |
| US-04.06 | View client session history | Professional | P1 |
| US-04.07 | Update client status | Practice Admin | P1 |
| US-04.08 | Track client progress | Professional | P1 |

### US-05: Service Management
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-05.01 | Create service | Practice Admin | P0 |
| US-05.02 | Update service | Practice Admin | P0 |
| US-05.03 | Set service price | Practice Admin | P0 |
| US-05.04 | Set service duration (flexible, e.g., 60, 90, 120 min) | Practice Admin | P0 |
| US-05.05 | Assign service to professional | Practice Admin | P1 |
| US-05.06 | View service list | All Staff | P0 |
| US-05.07 | Set service type (konseling/asesmen/workshop) | Practice Admin | P1 |

### US-06: Session Management (Previously: Appointment)
> **Note:** Client books → PENDING → **Professional must approve** → BOOKED

| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-06.01 | Book session (creates PENDING request) | Client | P0 |
| US-06.01b | Approve/reject session request | Professional | P0 |
| US-06.02 | Book session for client | Staff | P0 |
| US-06.03 | View calendar | Staff | P0 |
| US-06.04 | Check in client | Receptionist | P0 |
| US-06.05 | Check out client | Receptionist | P0 |
| US-06.06 | Cancel session | Client, Staff | P0 |
| US-06.07 | Reschedule session | Client, Staff | P1 |
| US-06.08 | View session details | Staff | P0 |
| US-06.09 | Filter sessions | Staff | P1 |
| US-06.10 | Select session type (individual/group/assessment) | Client | P1 |

### US-07: Session Notes (Previously: Encounter)
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-07.01 | Create session notes | Professional | P1 |
| US-07.02 | Add notes content | Professional | P1 |
| US-07.03 | Close session notes | Professional | P1 |
| US-07.04 | View session notes list | Professional | P1 |
| US-07.05 | Print session notes | Professional | P2 |
| US-07.06 | Use notes template | Professional | P2 |

### US-08: Informed Consent
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-08.01 | Create consent form | Practice Admin | P1 |
| US-08.02 | Send consent for signature | Professional | P1 |
| US-08.03 | Sign consent form | Client | P0 |
| US-08.04 | View consent status | Professional | P1 |

### US-09: Intervention Plan / Recommendations (Previously: Prescription)
> **KEPT** - untuk menulis rekomendasi/activities untuk client

| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-09.01 | Create intervention plan | Professional | P1 |
| US-09.02 | Add recommendations/activities | Professional | P1 |
| US-09.03 | Set frequency and duration | Professional | P1 |
| US-09.04 | Add instructions | Professional | P2 |
| US-09.05 | View intervention plan | Client | P1 |
| US-09.06 | Print intervention plan | Professional | P2 |

### US-10: Billing
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-10.01 | Generate bill | Receptionist | P1 |
| US-10.02 | Add bill items | Receptionist | P1 |
| US-10.03 | Apply discount | Receptionist | P1 |
| US-10.04 | Print invoice | Receptionist | P1 |
| US-10.05 | Record payment | Receptionist | P1 |
| US-10.06 | View billing history | Practice Admin | P1 |

### US-11: Public Booking Portal
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-11.01 | Browse available professionals | Visitor | P0 |
| US-11.02 | Select session type | Visitor | P0 |
| US-11.03 | Choose date and time | Visitor | P0 |
| US-11.04 | Register during booking | Visitor | P1 |
| US-11.05 | View booking confirmation | Client | P0 |
| US-11.06 | Login to existing account | Visitor | P1 |

### US-12: Dashboard & Reporting
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-12.01 | View dashboard overview | All Staff | P0 |
| US-12.02 | View today's sessions | Staff | P0 |
| US-12.03 | View upcoming sessions | Client | P1 |
| US-12.04 | View statistics | Practice Admin | P1 |
| US-12.05 | View active clients count | Professional | P1 |

### US-13: Settings
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-13.01 | Configure general settings | Super Admin | P1 |
| US-13.02 | Configure session settings | Practice Admin | P1 |
| US-13.03 | Customize email templates | Practice Admin | P1 |
| US-13.04 | Manage consent templates | Practice Admin | P1 |

### US-14: Communication
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-14.01 | Receive welcome email | Client | P2 |
| US-14.02 | Receive session confirmation | Client | P0 |
| US-14.03 | Receive session reminder | Client | P1 |

---

## User Story Templates by Role

### Super Admin
```
As a Super Admin
I want to manage all aspects of the system
So that I can ensure proper system operation
```

### Practice Admin (Previously: Clinic Admin)
```
As a Practice Admin
I want to manage my practice's operations
So that my practice runs smoothly
```

### Professional (Previously: Doctor)
```
As a Professional (Psikolog)
I want to manage my schedule and client care
So that I can provide better psychological services
```

### Receptionist
```
As a Receptionist
I want to efficiently manage sessions
So that clients have a smooth experience
```

### Client (Previously: Patient)
```
As a Client
I want to easily book sessions
So that I can receive timely psychological support
```

---

## Definition of Ready (DoR)

A user story is ready for implementation when:
- [ ] Title clearly describes the goal
- [ ] Acceptance criteria are specific and testable
- [ ] Priority is assigned
- [ ] Dependencies are identified
- [ ] Role mapping to psychology context is clear

## Definition of Done (DoD)

A user story is done when:
- [ ] Code is written and reviewed
- [ ] All acceptance criteria are met
- [ ] Unit tests are written
- [ ] No new bugs introduced
- [ ] Documentation updated
- [ ] Terminology follows psychology practice standards

---

*Document Owner: PraktiQU Team*  
*Last Updated: 2026-05-22*