# User Stories Index

**Project:** PraktiQU - Next.js Clinic Management System (EHR)  
**Document:** US Index - User Stories  
**Version:** 1.0  
**Date:** 2026-05-22  
**Status:** Draft - For Review  

---

## Overview

This document indexes all User Stories derived from the KiviCare WordPress plugin analysis. Each user story is written from the perspective of a specific user role.

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
| US-01.01 | Register new user account | Patient | P0 |
| US-01.02 | Login to system | All Users | P0 |
| US-01.03 | Reset forgotten password | All Users | P0 |
| US-01.04 | Logout from system | All Users | P0 |
| US-01.05 | View role-based dashboard | All Users | P0 |
| US-01.06 | Manage profile information | All Users | P1 |

### US-02: Clinic Management
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-02.01 | Set up clinic profile | Super Admin | P0 |
| US-02.02 | Update clinic information | Clinic Admin | P0 |
| US-02.03 | Upload clinic logo | Clinic Admin | P1 |
| US-02.04 | Configure clinic schedule | Clinic Admin | P1 |
| US-02.05 | Set clinic timezone | Clinic Admin | P1 |
| US-02.06 | Configure currency | Clinic Admin | P1 |
| US-02.07 | Manage holidays | Clinic Admin | P1 |

### US-03: Doctor Management
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-03.01 | Register as doctor | Super Admin | P0 |
| US-03.02 | Complete doctor profile | Doctor | P0 |
| US-03.03 | Set specialties | Doctor | P1 |
| US-03.04 | Assign services | Doctor | P1 |
| US-03.05 | Configure availability | Doctor | P0 |
| US-03.06 | Set day-wise schedule | Doctor | P0 |
| US-03.07 | View doctor list | Clinic Admin | P0 |
| US-03.08 | Update doctor status | Clinic Admin | P1 |

### US-04: Patient Management
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-04.01 | Register as patient | Patient | P0 |
| US-04.02 | Complete patient profile | Patient | P0 |
| US-04.03 | Add patient by staff | Receptionist | P0 |
| US-04.04 | Search patients | Staff | P0 |
| US-04.05 | View patient details | Staff | P0 |
| US-04.06 | View patient history | Doctor | P1 |
| US-04.07 | Update patient status | Clinic Admin | P1 |

### US-05: Service Management
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-05.01 | Create service | Clinic Admin | P0 |
| US-05.02 | Update service | Clinic Admin | P0 |
| US-05.03 | Set service price | Clinic Admin | P0 |
| US-05.04 | Assign service to doctor | Clinic Admin | P1 |
| US-05.05 | View service list | All Staff | P0 |

### US-06: Appointment Management
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-06.01 | Book appointment | Patient | P0 |
| US-06.02 | View calendar | Staff | P0 |
| US-06.03 | Check in patient | Receptionist | P0 |
| US-06.04 | Check out patient | Receptionist | P0 |
| US-06.05 | Cancel appointment | Patient, Staff | P0 |
| US-06.06 | Reschedule appointment | Patient, Staff | P1 |
| US-06.07 | View appointment details | Staff | P0 |
| US-06.08 | Filter appointments | Staff | P1 |

### US-07: Encounter Management
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-07.01 | Create encounter | Doctor | P1 |
| US-07.02 | Add clinical notes | Doctor | P1 |
| US-07.03 | Upload medical report | Doctor | P2 |
| US-07.04 | Close encounter | Doctor | P1 |
| US-07.05 | Record vital signs | Doctor | P2 |
| US-07.06 | Print encounter | Doctor | P2 |

### US-08: Prescription Management
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-08.01 | Create prescription | Doctor | P1 |
| US-08.02 | Add medicine details | Doctor | P1 |
| US-08.03 | Print prescription | Doctor | P2 |
| US-08.04 | View prescriptions | Patient | P1 |

### US-09: Billing
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-09.01 | Generate bill | Receptionist | P1 |
| US-09.02 | Add bill items | Receptionist | P1 |
| US-09.03 | Apply discount | Receptionist | P1 |
| US-09.04 | Print invoice | Receptionist | P1 |
| US-09.05 | Record payment | Receptionist | P1 |
| US-09.06 | View billing history | Clinic Admin | P1 |

### US-10: Public Booking Portal
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-10.01 | Browse available doctors | Visitor | P0 |
| US-10.02 | Select service | Visitor | P0 |
| US-10.03 | Choose date and time | Visitor | P0 |
| US-10.04 | Register during booking | Visitor | P1 |
| US-10.05 | View booking confirmation | Patient | P0 |
| US-10.06 | Login to existing account | Visitor | P1 |

### US-11: Dashboard & Reporting
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-11.01 | View dashboard overview | All Staff | P0 |
| US-11.02 | View today's appointments | Staff | P0 |
| US-11.03 | View upcoming appointments | Patient | P1 |
| US-11.04 | View statistics | Clinic Admin | P1 |
| US-11.05 | Export reports | Clinic Admin | P2 |

### US-12: Settings
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-12.01 | Configure general settings | Super Admin | P1 |
| US-12.02 | Configure appointment settings | Clinic Admin | P1 |
| US-12.03 | Customize email templates | Clinic Admin | P1 |
| US-12.04 | Set login redirects | Clinic Admin | P1 |

### US-13: Communication
| ID | Title | Role | Priority |
|----|-------|------|----------|
| US-13.01 | Receive welcome email | Patient | P2 |
| US-13.02 | Receive appointment confirmation | Patient | P0 |
| US-13.03 | Receive appointment reminder | Patient | P1 |
| US-13.04 | Resend credentials | Clinic Admin | P2 |

---

## User Story Templates by Role

### Super Admin
```
As a Super Admin
I want to manage all aspects of the system
So that I can ensure proper system operation
```

### Clinic Admin
```
As a Clinic Admin
I want to manage my clinic's operations
So that my clinic runs smoothly
```

### Doctor
```
As a Doctor
I want to manage my schedule and patient care
So that I can provide better healthcare
```

### Receptionist
```
As a Receptionist
I want to efficiently manage appointments
So that patients have a smooth experience
```

### Patient
```
As a Patient
I want to easily book appointments
So that I can receive timely healthcare
```

---

## Definition of Ready (DoR)

A user story is ready for implementation when:
- [ ] Title clearly describes the goal
- [ ] Acceptance criteria are specific and testable
- [ ] Priority is assigned
- [ ] Dependencies are identified

## Definition of Done (DoD)

A user story is done when:
- [ ] Code is written and reviewed
- [ ] All acceptance criteria are met
- [ ] Unit tests are written
- [ ] No new bugs introduced

---

*Document Owner: PraktiQU Team*  
*Last Updated: 2026-05-22*