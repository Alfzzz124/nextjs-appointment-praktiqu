# Project Context

**Last reviewed**: 2026-06-01

## Product / Service

**PraktiQU** - Psychology Practice Management System for managing:
- Client appointments and session scheduling
- Professional psychologist schedules
- Multi-step public booking wizard
- Session approval workflow (professional → dashboard → approval)

**Target Users**:
- Admin staff (dashboard management)
- Professionals (psychologists managing their schedules)
- Clients (booking appointments via public wizard)

## Key Constraints

- **Design-First**: All UI must follow Stitch designs from `/stitch_praktiqu_clinic_dashboard/`
- **Trunk-Based Development**: Short-lived feature branches (max 3 days)
- **TDD + E2E Validation**: Unit tests before implementation, agent-based E2E after
- **WordPress MySQL Integration**: PraktiQU extends an existing WordPress database

## Important Domains

- Session management and calendar scheduling
- Role-based access control (Admin, Professional, Client)
- Appointment booking and approval workflow
- JWT authentication via NextAuth v5

## Current Priorities

1. Complete auth foundation (001-auth-foundation feature)
2. Implement session management core
3. Build client dashboard
4. Build professional dashboard with approval workflow
5. Implement public booking wizard

## Keep Here

- Technology stack decisions (Next.js 14+, Prisma, MySQL, NextAuth v5)
- API conventions and response formats
- Project structure and folder organization
- CI/CD pipeline requirements
- Design standards and Stitch reference

## Never Store Here

- Feature-specific acceptance criteria (use spec.md)
- Task lists (use tasks.md)
- Implementation notes (use plan.md or memory.md)
- Changelog entries (use worklog/ for milestones only)

> **Update the review date** when constraints or priorities change materially.
