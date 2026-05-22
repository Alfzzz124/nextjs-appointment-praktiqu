# PraktiQU - KiviCare Next.js Migration Project

## Overview

This document captures the project to clone/recreate the KiviCare WordPress plugin as a standalone Next.js application.

**Source**: KiviCare Clinic & Patient Management System (EHR) v4.4.0
**Target**: PraktiQU - Next.js Clinic Management Application

---

## KiviCare WordPress Plugin Analysis

### Core Technology Stack
- **Frontend**: React 19 + Bootstrap 5 (compiled to dist/assets/)
- **Backend**: WordPress REST API (namespace: `kivi-care`)
- **Database**: WordPress + custom tables (`wp_kc_*`)
- **Authentication**: WordPress cookies + Application Passwords

### Key Modules Identified

#### 1. Clinic Management
- CRUD for clinics with full address details
- Multi-clinic support (Pro feature)
- Clinic admin assignment
- Clinic schedule/holidays

#### 2. User Management (Multi-Role)
| Role | WordPress Role | Capabilities |
|------|----------------|--------------|
| Super Admin | administrator | Full system access |
| Clinic Admin | kiviCare_clinic_admin | Clinic-level management |
| Doctor | kiviCare_doctor | Patient care, scheduling |
| Receptionist | kiviCare_receptionist | Front desk operations |
| Patient | kiviCare_patient | Self-service portal |

#### 3. Doctor Management
- Doctor profiles with specialties
- Service associations
- Session/time slot management
- Day-wise availability scheduling
- Multi-clinic assignments (Pro)

#### 4. Patient Management
- Patient registration/login
- Unique patient ID generation
- Medical history tracking
- Multi-clinic registration
- Profile with photo, contact, demographics

#### 5. Appointment System
- Calendar-based booking
- Doctor/service selection
- Status workflow: Pending → Confirmed → Check-in → Check-out → Complete
- Conflict prevention
- Auto-close for past appointments
- Appointment reminders

#### 6. Encounter Management
- Patient visit tracking
- Clinical notes
- Medical reports upload
- Prescription management
- Body chart annotation (Addon)

#### 7. Billing & Payments
- Service-based pricing
- Encounter billing
- Payment gateways:
  - PayPal
  - Stripe (Addon)
  - Razorpay (Addon)
  - KnitPay (500+ gateways)
  - WooCommerce (Pro)
- Tax calculations

#### 8. Services Module
- Service catalog with pricing
- Service-doctor mappings
- Private/public service flag

#### 9. Prescription System
- Medication prescriptions
- Dosage and frequency tracking
- Prescription templates

#### 10. Reporting & Dashboard
- Real-time clinic overview
- Appointment statistics
- Revenue reports
- Patient statistics

#### 11. Communication
- Email notifications (templated)
- SMS via Twilio (Addon)
- WhatsApp alerts (Addon)
- Appointment reminders

### Database Schema (Core Tables)

```
wp_kc_appointments
├── id, clinic_id, doctor_id, patient_id
├── appointment_start_date/time, appointment_end_date/time
├── visit_type, description, status
└── created_at, appointment_report

wp_kc_clinics
├── id, name, email, telephone_no
├── address, city, state, country, postal_code
├── clinic_admin_id, clinic_logo, status
└── country_code, country_calling_code

wp_kc_doctors
├── id, user_id, specialties
├── consultation_fee, signature, status
└── created_at, updated_at

wp_kc_patients
├── id, user_id, patient_unique_id
├── blood_group, emergency_contact
└── status, registered_at

wp_kc_services
├── id, type, name, price, duration
├── status, clinic_id
└── created_at

wp_kc_patient_encounters
├── id, appointment_id, patient_id, doctor_id, clinic_id
├── encounter_date, status, clinical_notes
├── medical_report, template_id
└── created_at

wp_kc_prescriptions
├── id, encounter_id, patient_id, doctor_id
├── medicine_name, dosage, frequency, duration
├── instructions
└── created_at

wp_kc_bills
├── id, encounter_id, clinic_id
├── total_amount, discount, tax_amount
└── actual_amount, payment_status

wp_kc_bill_items
├── id, bill_id, service_id
├── item_name, price, quantity
└── created_at
```

### WordPress REST API Endpoints

| Route | Methods | Description |
|-------|---------|-------------|
| `/wp-json/kivi-care/appointments` | GET, POST | Appointments CRUD |
| `/wp-json/kivi-care/clinics` | GET, POST | Clinics management |
| `/wp-json/kivi-care/doctors` | GET, POST | Doctors management |
| `/wp-json/kivi-care/patients` | GET, POST | Patients management |
| `/wp-json/kivi-care/services` | GET, POST | Services catalog |
| `/wp-json/kivi-care/encounters` | GET, POST | Patient encounters |
| `/wp-json/kivi-care/bills` | GET, POST | Billing operations |
| `/wp-json/kivi-care/prescriptions` | GET, POST | Prescriptions |
| `/wp-json/kivi-care/dashboard` | GET | Dashboard data |
| `/wp-json/kivi-care/settings/*` | GET, POST | Configuration |
| `/wp-json/kivi-care/static-data` | GET | Static reference data |
| `/wp-json/kivi-care/auth/*` | POST | Authentication |

### Pro/Addon Features (Out of Scope for MVP)
- Multi-clinic enterprise management
- Google Calendar integration
- Zoom/Google Meet telemedicine
- SMS notifications (Twilio)
- WhatsApp alerts
- WooCommerce integration
- Stripe/Razorpay payment gateways
- Body chart editor
- Custom forms (Pro)

---

## Next.js Implementation Strategy

### Technology Stack
- **Framework**: Next.js 14+ (App Router)
- **UI**: React 19 + Tailwind CSS
- **State**: TanStack Query (React Query)
- **Forms**: React Hook Form + Zod
- **Database**: PostgreSQL (via Prisma)
- **Auth**: NextAuth.js with credentials provider
- **API**: REST API routes
- **Calendar**: FullCalendar or custom implementation

### Project Structure
```
/praktiqu
├── /src
│   ├── /app                    # Next.js App Router
│   │   ├── /api                # API routes
│   │   ├── /(auth)             # Auth pages
│   │   └── /(dashboard)        # Protected dashboard
│   ├── /components
│   │   ├── /ui                 # Base UI components
│   │   ├── /forms              # Form components
│   │   ├── /calendar           # Calendar components
│   │   └── /layouts            # Layout components
│   ├── /lib
│   │   ├── /db                 # Database client
│   │   ├── /auth               # Auth config
│   │   └── /utils              # Utilities
│   ├── /hooks                  # Custom hooks
│   ├── /types                  # TypeScript types
│   └── /validations            # Zod schemas
├── /prisma
│   └── schema.prisma           # Database schema
└── /public                     # Static assets
```

---

## References

- [KiviCare WordPress Plugin](https://kivicare.io)
- [KiviCare Documentation](https://documentation.iqonic.design/kivicare-wordpress)
- [KiviCare Demo](https://demo.kivicare.io)