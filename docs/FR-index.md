# Functional Requirements Index

**Project:** PraktiQU - Next.js Clinic Management System (EHR)  
**Document:** FR Index - Functional Requirements  
**Version:** 1.0  
**Date:** 2026-05-22  
**Status:** Draft - For Review  

---

## Overview

This document indexes all Functional Requirements derived from the KiviCare WordPress plugin analysis. Each requirement is numbered, categorized, and prioritized for implementation.

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
| FR-01.09 | Profile image upload | P2 |

### FR-02: Clinic Management
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-02.01 | Create clinic | P0 |
| FR-02.02 | Update clinic details | P0 |
| FR-02.03 | Delete clinic | P1 |
| FR-02.04 | Clinic logo upload | P1 |
| FR-02.05 | Clinic address management | P0 |
| FR-02.06 | Clinic contact information | P0 |
| FR-02.07 | Clinic specialties assignment | P1 |
| FR-02.08 | Clinic timezone configuration | P1 |
| FR-02.09 | Clinic currency settings | P1 |
| FR-02.10 | Clinic status (active/inactive) | P1 |

### FR-03: Doctor Management
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-03.01 | Doctor registration | P0 |
| FR-03.02 | Doctor profile management | P0 |
| FR-03.03 | Doctor specialty assignment | P1 |
| FR-03.04 | Doctor service association | P1 |
| FR-03.05 | Doctor clinic assignment | P1 |
| FR-03.06 | Doctor availability schedule | P0 |
| FR-03.07 | Day-wise time slot configuration | P0 |
| FR-03.08 | Doctor digital signature | P2 |
| FR-03.09 | Doctor status management | P1 |
| FR-03.10 | Doctor list with search/filter | P0 |

### FR-04: Patient Management
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-04.01 | Patient registration | P0 |
| FR-04.02 | Patient unique ID generation | P1 |
| FR-04.03 | Patient profile with demographics | P0 |
| FR-04.04 | Patient medical history | P1 |
| FR-04.05 | Patient clinic registration | P1 |
| FR-04.06 | Patient self-registration portal | P1 |
| FR-04.07 | Patient status management | P1 |
| FR-04.08 | Patient list with pagination | P0 |
| FR-04.09 | Patient search by mobile number | P1 |
| FR-04.10 | Patient statistics | P2 |

### FR-05: Service Catalog
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-05.01 | Create service | P0 |
| FR-05.02 | Update service | P0 |
| FR-05.03 | Delete service | P1 |
| FR-05.04 | Service pricing | P0 |
| FR-05.05 | Service duration | P1 |
| FR-05.06 | Service type classification | P1 |
| FR-05.07 | Private/public service flag | P2 |
| FR-05.08 | Service image | P2 |

### FR-06: Appointment System
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-06.01 | Create appointment | P0 |
| FR-06.02 | Update appointment | P0 |
| FR-06.03 | Cancel appointment | P0 |
| FR-06.04 | Appointment status workflow | P0 |
| FR-06.05 | Calendar view display | P0 |
| FR-06.06 | Time slot generation | P0 |
| FR-06.07 | Conflict prevention | P1 |
| FR-06.08 | Auto-close past appointments | P2 |
| FR-06.09 | Appointment filters | P1 |
| FR-06.10 | Appointment export (CSV) | P2 |
| FR-06.11 | Visit type (in-person/telemed) | P1 |
| FR-06.12 | Multi-timezone support | P1 |

### FR-07: Encounter Management
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-07.01 | Create encounter | P1 |
| FR-07.02 | Clinical notes | P1 |
| FR-07.03 | Encounter status (open/closed) | P1 |
| FR-07.04 | Encounter template | P2 |
| FR-07.05 | Medical report upload | P2 |
| FR-07.06 | Vital signs recording | P2 |
| FR-07.07 | Encounter print | P2 |
| FR-07.08 | Link to appointment | P1 |

### FR-08: Prescription Management
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-08.01 | Create prescription | P1 |
| FR-08.02 | Prescription details (medicine, dosage, frequency) | P1 |
| FR-08.03 | Prescription duration | P1 |
| FR-08.04 | Prescription instructions | P2 |
| FR-08.05 | Prescription list | P1 |
| FR-08.06 | Prescription print | P2 |

### FR-09: Billing & Payments
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-09.01 | Generate bill | P1 |
| FR-09.02 | Bill items management | P1 |
| FR-09.03 | Discount application | P1 |
| FR-09.04 | Tax calculation | P2 |
| FR-09.05 | Invoice generation | P1 |
| FR-09.06 | Invoice print | P1 |
| FR-09.07 | Payment status tracking | P1 |
| FR-09.08 | Payment method recording | P1 |
| FR-09.09 | Currency prefix/postfix | P1 |

### FR-10: Communication & Notifications
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-10.01 | Email notification sending | P1 |
| FR-10.02 | Email template customization | P1 |
| FR-10.03 | Appointment reminders | P1 |
| FR-10.04 | Patient welcome email | P2 |
| FR-10.05 | HTML email templates | P1 |
| FR-10.06 | Background job queue | P2 |

### FR-11: Public Booking Portal
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-11.01 | Public booking page | P0 |
| FR-11.02 | Doctor selection | P0 |
| FR-11.03 | Service selection | P0 |
| FR-11.04 | Date/time selection | P0 |
| FR-11.05 | Inline patient registration | P1 |
| FR-11.06 | Shortcode/widget support | P1 |
| FR-11.07 | Clinic list display | P1 |
| FR-11.08 | Login/register page | P1 |
| FR-11.09 | Booking confirmation | P0 |

### FR-12: Dashboard & Reporting
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-12.01 | Dashboard overview | P0 |
| FR-12.02 | Appointment statistics | P1 |
| FR-12.03 | Patient statistics | P2 |
| FR-12.04 | Revenue reports | P2 |
| FR-12.05 | Data export | P2 |
| FR-12.06 | Calendar integration | P0 |

### FR-13: Scheduling & Holidays
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-13.01 | Clinic schedule management | P1 |
| FR-13.02 | Holiday management | P1 |
| FR-13.03 | Holiday range dates | P1 |
| FR-13.04 | Doctor off days | P1 |
| FR-13.05 | Display holidays on calendar | P1 |
| FR-13.06 | Remaining slots display | P1 |

### FR-14: Custom Fields & Forms
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-14.01 | Custom field builder | P2 |
| FR-14.02 | Field types (text, select, date, etc.) | P2 |
| FR-14.03 | Module-specific fields | P2 |
| FR-14.04 | Clinic-specific fields | P2 |

### FR-15: Settings & Configuration
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-15.01 | General settings | P1 |
| FR-15.02 | Appointment settings | P1 |
| FR-15.03 | Patient settings | P1 |
| FR-15.04 | Email settings | P1 |
| FR-15.05 | Login redirect settings | P1 |
| FR-15.06 | Gender options | P1 |
| FR-15.07 | Date/time format | P1 |

### FR-16: Security & Compliance
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-16.01 | End-to-end encryption (E2EE) | P1 |
| FR-16.02 | Data encryption at rest | P1 |
| FR-16.03 | Session security | P0 |
| FR-16.04 | SQL injection prevention | P0 |
| FR-16.05 | Input validation | P0 |

### FR-17: UI/UX Requirements
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-17.01 | Responsive design | P0 |
| FR-17.02 | Dark mode | P2 |
| FR-17.03 | Loading skeletons | P1 |
| FR-17.04 | Error states | P1 |
| FR-17.05 | Empty states | P2 |
| FR-17.06 | Multi-language support | P2 |

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