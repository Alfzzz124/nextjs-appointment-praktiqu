# Architecture Overview

## Technology Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 14+ (App Router) |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS + Inter font |
| Database | MySQL (WordPress existing DB) + Prisma ORM |
| Auth | NextAuth.js v5 |
| State | React Server Components + Zustand |
| Testing | Vitest + @vercel/agent-browser |
| Deployment | Vercel |

## Database Integration

PraktiQU extends an existing WordPress MySQL database:
- Prisma schema maps to existing WordPress tables
- Custom tables added for: clients, professionals, sessions, bookings
- WP tables: users, usermeta (reused for professionals)

## Application Architecture

### Source Code Structure

```
src/
├── app/              # Next.js App Router pages and layouts
├── components/       # React components (ui/, session/, client/, layout/)
├── lib/              # Utilities and helpers
├── services/         # Business logic layer
├── api/              # API route handlers (src/app/api/v1/)
├── hooks/            # Custom React hooks
└── types/            # TypeScript type definitions
```

### API Design

**Base URL**: `/api/v1/{resource}`

**Response Format**:
```json
{
  "data": { ... },
  "pagination": { "currentPage": 1, "totalPages": 5, "totalItems": 100 }
}
```

**Error Format (RFC 7807)**:
```json
{
  "type": "/errors/resource-not-found",
  "title": "Resource Not Found",
  "status": 404,
  "detail": "..."
}
```

## Key Entities

- **User**: WordPress user (extended roles: professional, client)
- **Client**: Client profile with contact info
- **Professional**: Psychologist profile with availability
- **Session**: Booked session between professional and client
- **Booking**: Request submission through public wizard

## Security Model

- JWT Bearer token authentication
- Service-level permission checks
- Role-based access control (RBAC)
- Rate limiting: 100 requests/minute per user

## Component Layer

### UI Components (src/components/ui/)

Base UI primitive components following design system.

### Feature Components

- `src/components/session/` - Session management
- `src/components/client/` - Client dashboard
- `src/components/professional/` - Professional dashboard
- `src/components/layout/` - Layout components (header, sidebar)

## Configuration

Environment variables in `.env.local`:
- `DATABASE_URL` - MySQL connection string
- `NEXTAUTH_SECRET` - NextAuth secret key
- `NEXTAUTH_URL` - Application URL

## Integration Points

- **WordPress DB**: Users, authentication via WP cookies
- **Stitch Designs**: `stitch_praktiqu_clinic_dashboard/` folder
- **Prisma**: Database schema at `prisma/schema.prisma`
