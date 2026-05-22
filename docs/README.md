# PraktiQU - Next.js Psychology Practice Management System

> A modern, full-featured psychology practice management system built with Next.js 14+, inspired by the KiviCare WordPress plugin but adapted for psychological services.

![Next.js](https://img.shields.io/badge/Next.js-14+-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5+-blue)
![Prisma](https://img.shields.io/badge/Prisma-ORM-green)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-blue)

## 🎯 Overview

PraktiQU is a standalone Next.js application designed to replicate and improve upon the functionality of KiviCare, adapted specifically for **Psychology Practice Management**. The system provides a complete EHR solution for psychologists and mental health professionals.

### Key Adaptations from KiviCare (Medical)

| KiviCare (Medical) | → | PraktiQU (Psychology) |
|--------------------|---|------------------------|
| Doctor | → | **Professional / Psikolog** |
| Patient | → | **Client / Klien** |
| Prescription | → | **Intervention Plan** (KEPT - untuk rekomendasi) |
| Clinical Notes | → | **Session Notes / Catatan Konseling** |
| Vital Signs | → | **Not Applicable** |
| Session Duration | 15-30 min | **50-60 min (standard psychology session)** |

### Features

- **Multi-Role User System**: Super Admin, Clinic Admin, Professional (Psikolog/Psikiater), Receptionist, Client
- **Professional Management**: Registration, profiles, specialties, availability scheduling
- **Client Management**: Registration, session history, unique ID generation, informed consent
- **Session Management**: Calendar-based booking with status workflow (50-min default)
- **Session Notes**: Professional documentation with templates
- **Informed Consent**: Digital consent form management
- **Billing**: Invoice generation and payment tracking
- **Public Booking**: Beautiful public-facing booking form
- **Notifications**: Email reminders and confirmations
- **Dashboard**: Real-time statistics and overview

## 📋 Requirements

- Node.js 20.x or higher
- pnpm 8.x or npm 9.x
- PostgreSQL 14+ (or Docker)
- GitHub account (for deployment)

## 🛠️ Quick Start

```bash
# Clone the repository
git clone git@github.com:PraktiQU/praktiqu.git
cd praktiqu

# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env.local

# Configure your database in .env.local
# DATABASE_URL="postgresql://..."

# Push database schema
pnpm prisma db push

# Start development server
pnpm dev
```

Visit [http://localhost:3000](http://localhost:3000) to see the application.

## 📁 Project Structure

```
/praktiqu
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # API routes
│   │   ├── (auth)/             # Authentication pages
│   │   └── (dashboard)/        # Protected dashboard
│   ├── components/              # React components
│   ├── lib/                    # Utilities & database
│   │   ├── mapping/            # KiviCare to PraktiQU mappers
│   │   └── ...
│   ├── hooks/                  # Custom hooks
│   ├── types/                  # TypeScript types
│   └── validations/            # Zod schemas
├── prisma/
│   └── schema.prisma           # Database schema
├── docs/                       # Documentation
│   ├── FR/                     # Functional Requirements
│   ├── BR/                     # Business Requirements
│   └── US/                     # User Stories
└── public/                     # Static assets
```

## 🔄 Database Mapping

Since PraktiQU uses the **existing KiviCare database**, entity names are mapped:

| KiviCare Table | → | PraktiQU Entity | Notes |
|---------------|----|-----------------|-------|
| `wp_kc_doctors` | → | **Professional** | Same table, renamed |
| `wp_kc_patients` | → | **Client** | Same table, renamed |
| `wp_kc_appointments` | → | **Session** | Same table, renamed |
| `wp_kc_patient_encounters` | → | **Session Notes** | Renamed entity |
| `wp_kc_prescriptions` | → | **(Removed)** | Not applicable |
| `wp_kc_vital_signs` | → | **Optional** | Not priority |

See [docs/database-mapping.md](./docs/database-mapping.md) for full details.

## 🔐 User Roles

| Role | Description | Access Level |
|------|-------------|--------------|
| Super Admin | Full system control | All modules, all practices |
| Clinic Admin | Practice-level management | Assigned clinic |
| Professional | Psychologist/Psychiatrist | Assigned clients, sessions |
| Receptionist | Front desk operations | Sessions, client registration |
| Client | Self-service portal | Own records, self-booking |

## 📚 Documentation

- [Project Analysis](./docs/PROJECT-ANALYSIS.md) - Detailed analysis of KiviCare plugin
- [Setup Guide](./docs/SETUP-GUIDE.md) - Installation and configuration
- [Database Mapping](./docs/database-mapping.md) - KiviCare to PraktiQU entity mapping
- [Functional Requirements Index](./docs/FR-index.md) - 100+ functional requirements
- [Business Requirements Index](./docs/BR-index.md) - Business rules and objectives
- [User Stories Index](./docs/US-index.md) - 50+ user stories
- [Implementation Plan](./docs/IMPLEMENTATION-PLAN.md) - 114 issues across 18 milestones
- [GitHub Setup](./docs/GITHUB-SETUP.md) - Repository configuration

## 🗺️ Roadmap

### Phase 1: MVP
- [x] Project setup with Next.js 14+
- [x] Database schema design
- [ ] Authentication system (Professional/Client roles)
- [ ] Professional management
- [ ] Client management
- [ ] Session system with calendar (50-min duration)
- [ ] Public booking page

### Phase 2: Core Features
- [ ] Session notes documentation
- [ ] Informed consent management
- [ ] Billing & invoices
- [ ] Email notifications

### Phase 3: Polish
- [ ] Dashboard with statistics
- [ ] Intervention plans (non-medication)
- [ ] Settings pages
- [ ] UI/UX improvements

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **KiviCare** - The WordPress plugin that inspired this project
- **IQONIC Design** - The creators of KiviCare
- **Next.js Team** - For the amazing framework
- **Prisma** - For the excellent ORM

---

**Built with ❤️ for psychology professionals**