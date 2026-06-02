# PraktiQU - Next.js Clinic Management System

## Project Setup Guide

This guide will help you set up the PraktiQU project after cloning from GitHub.

---

## Prerequisites

- Node.js 20.x or higher
- pnpm 8.x or npm 9.x
- MySQL 8+ (or Docker for local development)
- GitHub account with SSH key configured

---

## Initial Setup

### 1. Clone the Repository

```bash
git clone git@github.com:PraktiQU/praktiqu.git
cd praktiqu
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Environment Configuration

Copy the example environment file and configure your settings:

```bash
cp .env.example .env.local
```

**Required Environment Variables:**

```env
# Database
DATABASE_URL="mysql://user:password@localhost:3306/praktiqu"

# NextAuth.js
NEXTAUTH_SECRET="your-secret-key-here-generate-with-openssl-rand-base64-32"
NEXTAUTH_URL="http://localhost:3000"

# Application
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

### 4. Database Setup

#### Option A: Using Prisma (Recommended)

```bash
# Push schema to database
pnpm prisma db push

# Generate Prisma client
pnpm prisma generate

# (Optional) Seed database with sample data
pnpm prisma db seed
```

#### Option B: Using Docker

```bash
# Start MySQL container
docker-compose up -d db

# Run migrations
pnpm prisma migrate dev
```

### 5. Start Development Server

```bash
pnpm dev
```

The application will be available at: http://localhost:3000

---

## Development Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server |
| `pnpm build` | Build for production |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm test` | Run tests |
| `pnpm db:push` | Push schema changes to database |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm db:seed` | Seed database with sample data |
| `pnpm prisma:generate` | Regenerate Prisma client |

---

## Project Structure

```
/praktiqu
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── api/                # API routes
│   │   ├── (auth)/             # Authentication pages
│   │   └── (dashboard)/        # Protected dashboard pages
│   ├── components/              # React components
│   ├── lib/                    # Utilities and helpers
│   ├── hooks/                  # Custom React hooks
│   ├── types/                  # TypeScript definitions
│   └── validations/            # Zod schemas
├── prisma/
│   └── schema.prisma           # Database schema
├── public/                     # Static assets
└── docs/                       # Documentation
```

---

## Default Roles

| Role | Description | Default Credentials |
|------|-------------|---------------------|
| Super Admin | Full system access | (Set during setup) |
| Clinic Admin | Clinic-level management | (Set during setup) |
| Doctor | Patient care & scheduling | (Set during setup) |
| Receptionist | Front desk operations | (Set during setup) |
| Patient | Self-service portal | (Set during setup) |

---

## Troubleshooting

### Database Connection Issues

1. Ensure PostgreSQL is running
2. Check DATABASE_URL in .env.local
3. Verify database user has correct permissions

### Prisma Client Errors

```bash
rm -rf node_modules/.prisma
pnpm prisma generate
```

### Port Already in Use

```bash
# Find and kill process on port 3000
npx kill-port 3000
# or
lsof -ti:3000 | xargs kill
```