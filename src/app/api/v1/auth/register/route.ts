/**
 * POST /api/v1/auth/register
 *
 * Admin-only endpoint to provision a new User account record.
 * Access: SUPER_ADMIN only.
 * Note: This creates the PraktiQU User row only. A matching WordPress account
 * must be created separately and linked via wpUserId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import type { AuthContext } from '@/lib/auth';
import { forbidden, conflict, badRequest } from '@/lib/problem-details';
import { registerAdminUser } from '@/services/auth/admin-auth.service';
import { AuthError } from '@/services/auth/service';
import { UserRole } from '@prisma/client';
import { z } from 'zod';

const VALID_ROLES = Object.values(UserRole) as [string, ...string[]];

const schema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(VALID_ROLES),
});

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext & { params: unknown }) => {
  if (ctx.actor.role !== 'SUPER_ADMIN') {
    return NextResponse.json(forbidden('forbidden', 'Only SUPER_ADMIN can register users'), {
      status: 403,
      headers: { 'Content-Type': 'application/problem+json' },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(badRequest('invalid_json', 'Request body must be valid JSON'), {
      status: 400,
      headers: { 'Content-Type': 'application/problem+json' },
    });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      badRequest('validation_error', 'Invalid request body', undefined),
      { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  try {
    const result = await registerAdminUser({
      email: parsed.data.email,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      role: parsed.data.role as UserRole,
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError && err.code === 'duplicate_email') {
      return NextResponse.json(
        conflict('duplicate_email', 'Email already registered'),
        { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
      );
    }
    throw err;
  }
});
