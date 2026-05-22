# PraktiQU Implementation Plan

## Project Overview

**Project Name:** PraktiQU - Next.js Clinic Management System (EHR)
**Goal:** Recreate KiviCare WordPress plugin as a standalone Next.js application
**Starting Point:** Analysis of KiviCare v4.4.0 WordPress plugin (2230 files, 42MB)

---

## Milestone 1: Project Foundation ⚙️

### Setup & Infrastructure

| Issue | Title | Priority | Labels |
|-------|-------|----------|--------|
| #1 | Initialize Next.js 14+ project with App Router | P0 | `enhancement`, `priority:high` |
| #2 | Configure TypeScript with strict mode | P0 | `enhancement` |
| #3 | Set up Tailwind CSS with design system | P0 | `enhancement` |
| #4 | Configure Prisma with PostgreSQL | P0 | `enhancement`, `priority:high` |
| #5 | Set up NextAuth.js with credentials provider | P0 | `enhancement`, `priority:high` |
| #6 | Configure ESLint and Prettier | P1 | `enhancement` |
| #7 | Set up environment configuration | P1 | `enhancement` |
| #8 | Create GitHub Actions CI/CD workflow | P1 | `enhancement`, `ci-cd` |

### Deliverables
- [ ] Working Next.js project structure
- [ ] Database connection working
- [ ] User authentication functional
- [ ] CI/CD pipeline configured

---

## Milestone 2: Database Schema 📊

### Database Design

| Issue | Title | Priority | Labels |
|-------|-------|----------|--------|
| #9 | Design & implement User/Role schema | P0 | `enhancement`, `database` |
| #10 | Design & implement Clinic schema | P0 | `enhancement`, `database` |
| #11 | Design & implement Doctor schema | P0 | `enhancement`, `database` |
| #12 | Design & implement Patient schema | P0 | `enhancement`, `database` |
| #13 | Design & implement Appointment schema | P0 | `enhancement`, `database` |
| #14 | Design & implement Service catalog schema | P1 | `enhancement`, `database` |
| #15 | Design & implement Encounter/Prescription schema | P1 | `enhancement`, `database` |
| #16 | Design & implement Billing schema | P1 | `enhancement`, `database` |
| #17 | Design & implement Holiday/Schedule schema | P1 | `enhancement`, `database` |
| #18 | Create database migrations | P0 | `database`, `priority:high` |
| #19 | Create database seeders | P2 | `enhancement` |

### Deliverables
- [ ] Complete Prisma schema
- [ ] Database migrations working
- [ ] Seed data for testing

---

## Milestone 3: Authentication & Authorization 🔐

### Authentication Features

| Issue | Title | Priority | Labels |
|-------|-------|----------|--------|
| #20 | Implement user registration | P0 | `feature`, `auth` |
| #21 | Implement user login | P0 | `feature`, `auth` |
| #22 | Implement password reset | P1 | `feature`, `auth` |
| #23 | Implement session management | P0 | `feature`, `auth` |
| #24 | Implement role-based access control | P0 | `feature`, `auth`, `security` |

### Role Permissions

| Issue | Title | Priority | Labels |
|-------|-------|----------|--------|
| #25 | Implement Super Admin permissions | P0 | `auth`, `security` |
| #26 | Implement Clinic Admin permissions | P0 | `auth`, `security` |
| #27 | Implement Doctor permissions | P0 | `auth`, `security` |
| #28 | Implement Receptionist permissions | P0 | `auth`, `security` |
| #29 | Implement Patient permissions | P0 | `auth`, `security` |

### Deliverables
- [ ] User registration/login working
- [ ] Role-based menu and permissions
- [ ] Protected routes functional

---

## Milestone 4: Clinic Management 🏥

### Core Features

| Issue | Title | Priority | Labels |
|-------|-------|----------|--------|
| #30 | Create clinic CRUD API endpoints | P0 | `api`, `clinic` |
| #31 | Create clinic management UI | P0 | `ui`, `clinic` |
| #32 | Implement clinic logo/image upload | P1 | `feature`, `clinic` |
| #33 | Implement clinic settings | P1 | `feature`, `clinic` |
| #34 | Implement clinic holiday management | P1 | `feature`, `clinic` |

### Deliverables
- [ ] Admin can create/edit/delete clinics
- [ ] Clinic details page with all fields
- [ ] Holiday calendar per clinic

---

## Milestone 5: Doctor Management 👨‍⚕️

### Core Features

| Issue | Title | Priority | Labels |
|-------|-------|----------|--------|
| #35 | Create doctor CRUD API endpoints | P0 | `api`, `doctor` |
| #36 | Create doctor management UI | P0 | `ui`, `doctor` |
| #37 | Implement doctor profile | P0 | `feature`, `doctor` |
| #38 | Implement doctor specialties | P1 | `feature`, `doctor` |
| #39 | Implement doctor-service associations | P1 | `feature`, `doctor` |
| #40 | Implement doctor-clinic assignments | P1 | `feature`, `doctor` |

### Deliverables
- [ ] Doctor list with search/filter
- [ ] Doctor profile with all details
- [ ] Specialty tagging system

---

## Milestone 6: Patient Management 👤

### Core Features

| Issue | Title | Priority | Labels |
|-------|-------|----------|--------|
| #41 | Create patient CRUD API endpoints | P0 | `api`, `patient` |
| #42 | Create patient management UI | P0 | `ui`, `patient` |
| #43 | Implement patient registration | P0 | `feature`, `patient` |
| #44 | Implement unique patient ID generation | P1 | `feature`, `patient` |
| #45 | Implement patient medical history | P1 | `feature`, `patient` |
| #46 | Implement patient statistics | P2 | `feature`, `patient` |
| #47 | Implement patient self-registration | P1 | `feature`, `patient` |

### Deliverables
- [ ] Patient list with pagination
- [ ] Patient profile with medical records
- [ ] Unique ID generation
- [ ] Self-registration portal

---

## Milestone 7: Service Catalog 📋

### Core Features

| Issue | Title | Priority | Labels |
|-------|-------|----------|--------|
| #48 | Create service CRUD API endpoints | P0 | `api`, `service` |
| #49 | Create service management UI | P0 | `ui`, `service` |
| #50 | Implement service pricing | P0 | `feature`, `service` |
| #51 | Implement private/public service flag | P2 | `feature`, `service` |

### Deliverables
- [ ] Service list with categories
- [ ] Service pricing display
- [ ] Doctor-service mappings

---

## Milestone 8: Appointment System 📅

### Core Features

| Issue | Title | Priority | Labels |
|-------|-------|----------|--------|
| #52 | Create appointment API endpoints | P0 | `api`, `appointment` |
| #53 | Create appointment list UI | P0 | `ui`, `appointment` |
| #54 | Implement calendar view | P0 | `feature`, `appointment` |
| #55 | Implement appointment booking flow | P0 | `feature`, `appointment` |
| #56 | Implement time slot generation | P0 | `feature`, `appointment` |
| #57 | Implement day-wise availability | P1 | `feature`, `appointment` |
| #58 | Implement status workflow | P0 | `feature`, `appointment` |
| #59 | Implement conflict prevention | P1 | `feature`, `appointment` |
| #60 | Implement auto-close past appointments | P2 | `feature`, `appointment` |

### Status Workflow
```
Pending (2) → Confirmed (1) → Check-in (4) → Check-out (3) → Complete
                                         ↓
                                    Cancelled (0)
```

### Deliverables
- [ ] Calendar view with appointments
- [ ] Booking wizard/flow
- [ ] Time slot generation
- [ ] Status management

---

## Milestone 9: Encounter & Prescriptions 💊

### Core Features

| Issue | Title | Priority | Labels |
|-------|-------|----------|--------|
| #61 | Create encounter API endpoints | P0 | `api`, `encounter` |
| #62 | Create encounter UI | P0 | `ui`, `encounter` |
| #63 | Implement clinical notes | P1 | `feature`, `encounter` |
| #64 | Create prescription API endpoints | P1 | `api`, `prescription` |
| #65 | Create prescription UI | P1 | `ui`, `prescription` |
| #66 | Implement prescription templates | P2 | `feature`, `prescription` |

### Deliverables
- [ ] Encounter management
- [ ] Clinical notes editor
- [ ] Prescription creation
- [ ] Print functionality

---

## Milestone 10: Billing & Payments 💰

### Core Features

| Issue | Title | Priority | Labels |
|-------|-------|----------|--------|
| #67 | Create billing API endpoints | P1 | `api`, `billing` |
| #68 | Create billing UI | P1 | `ui`, `billing` |
| #69 | Implement invoice generation | P1 | `feature`, `billing` |
| #70 | Implement tax calculations | P2 | `feature`, `billing` |
| #71 | Implement PayPal integration | P2 | `feature`, `payment` |
| #72 | Implement basic payment tracking | P1 | `feature`, `billing` |

### Deliverables
- [ ] Bill generation
- [ ] Invoice printing
- [ ] Tax calculations
- [ ] Payment status tracking

---

## Milestone 11: Communication 📧

### Core Features

| Issue | Title | Priority | Labels |
|-------|-------|----------|--------|
| #73 | Implement email notification service | P1 | `feature`, `communication` |
| #74 | Create email templates | P1 | `feature`, `communication` |
| #75 | Implement appointment reminders | P1 | `feature`, `communication` |
| #76 | Implement email queue (background jobs) | P2 | `enhancement`, `communication` |

### Deliverables
- [ ] Email sending functional
- [ ] Appointment confirmations
- [ ] Reminder emails

---

## Milestone 12: Dashboard & Reports 📊

### Core Features

| Issue | Title | Priority | Labels |
|-------|-------|----------|--------|
| #77 | Create dashboard API endpoint | P0 | `api`, `dashboard` |
| #78 | Create dashboard UI | P0 | `ui`, `dashboard` |
| #79 | Implement appointment statistics | P1 | `feature`, `dashboard` |
| #80 | Implement revenue reports | P2 | `feature`, `reports` |
| #81 | Implement patient statistics | P2 | `feature`, `reports` |

### Dashboard Widgets
- Total appointments (today/upcoming/completed)
- Total patients
- Total revenue
- Recent activity

### Deliverables
- [ ] Role-based dashboard
- [ ] Statistics cards
- [ ] Calendar integration

---

## Milestone 13: Public Booking Pages 🌐

### Core Features

| Issue | Title | Priority | Labels |
|-------|-------|----------|--------|
| #82 | Create public booking API endpoints | P0 | `api`, `booking` |
| #83 | Create public booking page | P0 | `ui`, `booking` |
| #84 | Implement doctor selection | P0 | `feature`, `booking` |
| #85 | Implement service selection | P0 | `feature`, `booking` |
| #86 | Implement date/time selection | P0 | `feature`, `booking` |
| #87 | Implement patient registration (inline) | P1 | `feature`, `booking` |
| #88 | Implement login/register shortcode/page | P1 | `feature`, `booking` |

### Deliverables
- [ ] Public-facing booking form
- [ ] Doctor/service selection
- [ ] Patient self-registration

---

## Milestone 14: UI/UX Polish ✨

### Core Features

| Issue | Title | Priority | Labels |
|-------|-------|----------|--------|
| #89 | Implement responsive design | P0 | `enhancement`, `ui` |
| #90 | Implement dark mode | P2 | `enhancement`, `ui` |
| #91 | Implement loading states/skeletons | P1 | `enhancement`, `ui` |
| #92 | Implement error handling UI | P1 | `enhancement`, `ui` |
| #93 | Implement empty states | P2 | `enhancement`, `ui` |
| #94 | Add internationalization (i18n) | P2 | `enhancement`, `i18n` |

### Deliverables
- [ ] Mobile-friendly UI
- [ ] Consistent design system
- [ ] Loading/error states

---

## Milestone 15: Customization & Settings ⚙️

### Core Features

| Issue | Title | Priority | Labels |
|-------|-------|----------|--------|
| #95 | Implement custom fields | P2 | `feature`, `customization` |
| #96 | Implement email template customization | P2 | `feature`, `customization` |
| #97 | Implement general settings | P1 | `feature`, `settings` |
| #98 | Implement appointment settings | P1 | `feature`, `settings` |
| #99 | Implement patient settings | P1 | `feature`, `settings` |

### Deliverables
- [ ] Settings pages for all modules
- [ ] Custom field builder
- [ ] Template customization

---

## Milestone 16: Testing & Quality Assurance 🧪

### Testing

| Issue | Title | Priority | Labels |
|-------|-------|----------|--------|
| #100 | Set up testing framework (Vitest) | P0 | `testing`, `enhancement` |
| #101 | Write unit tests for API routes | P1 | `testing` |
| #102 | Write integration tests | P2 | `testing` |
| #103 | Set up E2E testing (Playwright) | P2 | `testing`, `e2e` |
| #104 | Write E2E tests for critical flows | P2 | `testing`, `e2e` |

### Deliverables
- [ ] Test coverage > 70%
- [ ] CI/CD includes tests
- [ ] E2E tests for booking flow

---

## Milestone 17: Performance & Optimization 🚀

### Optimization

| Issue | Title | Priority | Labels |
|-------|-------|----------|--------|
| #105 | Implement query optimization | P1 | `performance`, `enhancement` |
| #106 | Implement caching layer | P2 | `performance`, `enhancement` |
| #107 | Implement pagination optimization | P1 | `performance`, `enhancement` |
| #108 | Implement lazy loading | P2 | `performance`, `enhancement` |

### Deliverables
- [ ] Fast page loads
- [ ] Optimized database queries
- [ ] Good Lighthouse scores

---

## Milestone 18: Deployment & Launch 🚀

### Deployment

| Issue | Title | Priority | Labels |
|-------|-------|----------|--------|
| #109 | Configure Vercel/deployment | P0 | `deployment`, `priority:high` |
| #110 | Set up staging environment | P1 | `deployment` |
| #111 | Configure production database | P0 | `deployment` |
| #112 | Set up monitoring & logging | P1 | `deployment` |
| #113 | Create deployment checklist | P1 | `documentation` |
| #114 | Write deployment documentation | P1 | `documentation` |

### Deliverables
- [ ] Production deployment ready
- [ ] Monitoring configured
- [ ] Documentation complete

---

## Total Issues: 114

| Priority | Count |
|----------|-------|
| P0 (Critical) | 30 |
| P1 (High) | 40 |
| P2 (Medium/Low) | 44 |

| Type | Count |
|------|-------|
| API | 20 |
| UI | 20 |
| Feature | 50 |
| Enhancement | 15 |
| Database | 9 |
| Testing | 5 |
| Deployment | 6 |

---

## Development Phases

### Phase 1: MVP (Issues #1-53)
- Foundation, Schema, Auth, Clinic, Doctor, Patient, basic Services & Appointments

### Phase 2: Core Features (Issues #54-80)
- Advanced Appointments, Encounters, Prescriptions, Billing, Communication

### Phase 3: Polish (Issues #81-108)
- Public Booking, UI/UX, Settings, Performance

### Phase 4: Launch (Issues #109-114)
- Testing, Deployment, Documentation

---

## Dependencies

### Phase 1 Prerequisites
- #1 → #2, #3, #4, #5
- #4 → #9-#19
- #5 → #20-#29
- #9-#19 → #30-#40

### Key Dependencies
```
#1 Next.js Setup
├── #2 TypeScript
├── #3 Tailwind CSS
├── #4 Prisma
└── #5 NextAuth.js
    └── #20 User Auth
         └── #24 RBAC
              └── All CRUD operations

#9-#19 Database Schema
├── #30 Clinic CRUD
├── #35 Doctor CRUD
└── #41 Patient CRUD

#52 Appointment API
├── #53 Appointment UI
├── #54 Calendar View
└── #55-#60 Appointment Features
```

---

## Notes

- Pro features (Multi-clinic enterprise, Google Calendar, Zoom/Meet, SMS, WooCommerce) are out of MVP scope
- Focus on core single-clinic functionality first
- Build public booking as separate route group
- Use server actions where appropriate for better DX