# Business Requirements Index

**Project:** PraktiQU - Next.js Clinic Management System (EHR)  
**Document:** BR Index - Business Requirements  
**Version:** 1.0  
**Date:** 2026-05-22  
**Status:** Draft - For Review  

---

## Overview

This document indexes all Business Requirements derived from the KiviCare WordPress plugin analysis. These requirements define the business goals, objectives, and rules that the PraktiQU system must fulfill.

---

## Business Requirement Categories

### BR-01: Core Business Objectives
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-01.01 | Provide complete clinic management solution | P0 |
| BR-01.02 | Enable online appointment booking | P0 |
| BR-01.03 | Manage patient records electronically | P0 |
| BR-01.04 | Streamline front-desk operations | P1 |
| BR-01.05 | Reduce administrative workload | P1 |
| BR-01.06 | Improve patient experience | P1 |

### BR-02: User Management Business Rules
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-02.01 | Support 5 distinct user roles | P0 |
| BR-02.02 | Role determines visible modules | P0 |
| BR-02.03 | Role determines accessible data | P0 |
| BR-02.04 | Inactive accounts cannot login | P1 |
| BR-02.05 | User registration requires approval | P1 |
| BR-02.06 | Password security requirements | P1 |

### BR-03: Clinic Operations
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-03.01 | Single clinic per deployment (MVP) | P0 |
| BR-03.02 | Clinic is primary organizational unit | P0 |
| BR-03.03 | All services belong to a clinic | P1 |
| BR-03.04 | Clinic has timezone setting | P1 |
| BR-03.05 | Clinic has currency settings | P1 |
| BR-03.06 | Clinic can be activated/deactivated | P1 |

### BR-04: Appointment Business Rules
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-04.01 | Appointments must have doctor and patient | P0 |
| BR-04.02 | Appointments must have date and time | P0 |
| BR-04.03 | No double-booking for same doctor | P0 |
| BR-04.04 | Appointment status workflow rules | P0 |
| BR-04.05 | Cannot book during holidays | P1 |
| BR-04.06 | Cannot book during doctor off days | P1 |
| BR-04.07 | Past appointments auto-close | P2 |
| BR-04.08 | All times stored in UTC | P1 |
| BR-04.09 | Display in user's timezone | P1 |

### BR-05: Patient Data Management
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-05.01 | Each patient has unique ID | P0 |
| BR-05.02 | Patient can belong to multiple clinics | P1 |
| BR-05.03 | Patient must have valid email | P0 |
| BR-05.04 | Patient must have contact number | P0 |
| BR-05.05 | Medical history is patient-owned | P1 |
| BR-05.06 | Patient can self-register | P1 |
| BR-05.07 | Sensitive data must be encrypted | P1 |

### BR-06: Billing & Financial Rules
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-06.01 | Bill generated per encounter | P1 |
| BR-06.02 | Bill includes service items | P1 |
| BR-06.03 | Discount cannot exceed total | P1 |
| BR-06.04 | Tax calculated on discounted amount | P2 |
| BR-06.05 | Currency displayed per clinic setting | P1 |
| BR-06.06 | Payment status tracked | P1 |

### BR-07: Service & Pricing
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-07.01 | Services have fixed price | P0 |
| BR-07.02 | Services have defined duration | P1 |
| BR-07.03 | Service belongs to a clinic | P1 |
| BR-07.04 | Doctor can be assigned to services | P1 |
| BR-07.05 | Private services hidden from public | P2 |

### BR-08: Communication Rules
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-08.01 | Email sent on registration | P1 |
| BR-08.02 | Email sent on appointment confirmation | P0 |
| BR-08.03 | Reminder sent before appointment | P1 |
| BR-08.04 | Email templates are customizable | P1 |

### BR-09: Data Access Rules
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-09.01 | Doctors see own patients only | P0 |
| BR-09.02 | Receptionists see clinic patients | P0 |
| BR-09.03 | Clinic Admin sees clinic data | P0 |
| BR-09.04 | Super Admin sees all data | P0 |
| BR-09.05 | Patients see own records | P0 |

### BR-10: Compliance & Security
| ID | Requirement | Priority |
|----|-------------|----------|
| BR-10.01 | User data encrypted at rest | P1 |
| BR-10.02 | API requires authentication | P0 |
| BR-10.03 | Sessions expire after inactivity | P1 |
| BR-10.04 | Audit log for sensitive actions | P2 |

---

## Business Rules Summary

### Appointment Status Workflow
```
PENDING (2) → BOOKED (1) → CHECK_IN (4) → CHECK_OUT (3) → COMPLETED
       ↓
   CANCELLED (0)
```

### Role Hierarchy
```
Super Admin
    │
    ├── Clinic Admin
    │       │
    │       ├── Doctor
    │       │       │
    │       │       └── Patient
    │       │
    │       └── Receptionist
    │               │
    │               └── Patient
    │
    └── Patient
```

---

*Document Owner: PraktiQU Team*  
*Last Updated: 2026-05-22*