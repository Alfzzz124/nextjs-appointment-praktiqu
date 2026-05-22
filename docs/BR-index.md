# Business Requirements Index

**Project:** PraktiQU - Next.js Psychology Practice Management System  
**Document:** BR Index - Business Requirements  
**Version:** 1.2  
**Date:** 2026-05-22  
**Status:** Draft - For Review  

---

## Overview

This document indexes all Business Requirements adapted for **Psychology Practice Management**.

### Terminology Adaptation
| KiviCare (Medical) | → | PraktiQU (Psychology) |
|--------------------|---|------------------------|
| Doctor | → | **Professional** |
| Patient | → | **Client** |
| Appointment | → | **Session** |
| Prescription | → | **Intervention Plan / Recommendations** |

> **Note:** Prescription table (`wp_kc_prescriptions`) **KEPT** - isinya untuk menulis rekomendasi/activities yang perlu dilakukan client.

---

## Business Requirement Categories

### BR-01: Core Business Objectives
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-01.01 | Provide psychology practice management solution | P0 |
| BR-01.02 | Enable online session booking | P0 |
| BR-01.03 | Manage client records securely | P0 |
| BR-01.04 | Streamline front-desk operations | P1 |
| BR-01.05 | Support psychology documentation standards | P1 |
| BR-01.06 | Improve client experience | P1 |

### BR-02: User Management Business Rules
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-02.01 | Support 5 distinct user roles | P0 |
| BR-02.02 | Role determines visible modules | P0 |
| BR-02.03 | Role determines accessible data | P0 |
| BR-02.04 | Inactive accounts cannot login | P1 |
| BR-02.05 | User registration requires approval | P1 |

### BR-03: Professional Management
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-03.01 | Professional must have registration number (SIP/SIK) | P0 |
| BR-03.02 | Professional type (Psikolog Klinis, Psikiater) | P0 |
| BR-03.03 | Professional belongs to one or more practices | P1 |

### BR-04: Client Management
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-04.01 | Each client has unique ID | P0 |
| BR-04.02 | Client must have valid email | P0 |
| BR-04.03 | Client must have contact number | P0 |
| BR-04.04 | Client can self-register | P1 |
| BR-04.05 | Informed consent required before first session | P1 |

### BR-05: Session Business Rules
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-05.01 | Sessions must have professional and client | P0 |
| BR-05.02 | Sessions must have date and time | P0 |
| BR-05.03 | No double-booking for same professional | P0 |
| BR-05.04 | Session status workflow rules | P0 |
| BR-05.05 | Cannot book during holidays | P1 |
| BR-05.06 | Cannot book during professional off days | P1 |
| BR-05.07 | All times stored in UTC | P1 |
| BR-05.08 | Display in user's timezone | P1 |
| BR-05.09 | Standard session duration: 50 minutes | P0 |

### BR-06: Service & Session Types
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-06.01 | Services have fixed price | P0 |
| BR-06.02 | Services have defined duration | P1 |
| BR-06.03 | Service belongs to a practice | P1 |
| BR-06.04 | Session types: Individual, Group, Assessment | P1 |

### BR-07: Intervention Plan / Recommendations
> Formerly Prescription - but used for writing recommendations/activities for clients

| ID | Requirement | Priority |
|----|-------------|----------|
| BR-07.01 | Intervention plan created per session | P1 |
| BR-07.02 | Intervention plan includes recommendations | P1 |
| BR-07.03 | Intervention plan includes frequency/duration | P1 |
| BR-07.04 | Client can view intervention plan | P1 |

### BR-08: Billing & Financial Rules
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-08.01 | Bill generated per session | P1 |
| BR-08.02 | Bill includes service items | P1 |
| BR-08.03 | Discount cannot exceed total | P1 |
| BR-08.04 | Payment status tracked | P1 |

### BR-09: Communication Rules
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-09.01 | Email sent on registration | P1 |
| BR-09.02 | Email sent on session confirmation | P0 |
| BR-09.03 | Reminder sent before session | P1 |

### BR-10: Data Access Rules
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-10.01 | Professionals see own clients only | P0 |
| BR-10.02 | Receptionists see practice clients | P0 |
| BR-10.03 | Practice Admin sees practice data | P0 |
| BR-10.04 | Super Admin sees all data | P0 |
| BR-10.05 | Clients see own session history | P0 |

### BR-11: Compliance & Security
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-11.01 | User data encrypted at rest | P1 |
| BR-11.02 | API requires authentication | P0 |
| BR-11.03 | Sessions expire after inactivity | P1 |
| BR-11.04 | Psychology documentation confidentiality | P1 |
| BR-11.05 | Informed consent tracking | P1 |

### BR-12: Psychology Documentation Rules
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-12.01 | Informed consent mandatory before service | P0 |
| BR-12.02 | Session notes per session | P1 |
| BR-12.03 | Intervention plans for ongoing clients | P1 |

---

## Session Status Workflow
```
PENDING (2) → BOOKED (1) → CHECK_IN (4) → CHECK_OUT (3) → COMPLETED
       ↓
   CANCELLED (0)
```

## Role Hierarchy
```
Super Admin
    │
    ├── Practice Admin
    │       │
    │       ├── Professional (Psikolog/Psikiater)
    │       │       │
    │       │       └── Client
    │       │
    │       └── Receptionist
    │               │
    │               └── Client
    │
    └── Client
```

---

## Key Differences from Medical Clinic

| Aspect | Medical Clinic (KiviCare) | Psychology Practice (PraktiQU) |
|--------|-------------------------|--------------------------------|
| Standard session | 15-30 minutes | **50-60 minutes** |
| Prescription | For medication | **Intervention Plan for recommendations** |
| Informed Consent | Optional | **Mandatory** |
| Session Types | In-person/Telemed | **Individual, Group, Assessment** |

---

*Document Owner: PraktiQU Team*  
*Last Updated: 2026-05-22*