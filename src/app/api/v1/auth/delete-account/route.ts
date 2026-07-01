/**
 * DELETE /api/v1/auth/delete-account
 *
 * Soft-deletes a user account (sets status = 0 / inactive).
 *
 * Access rules:
 *   - SUPER_ADMIN: can delete any user (body: { userId: string })
 *   - Any authenticated user: deletes their own account (actor.id used; body ignored)
 *
 * Returns: 200 on success.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import type { AuthContext } from '@/lib/auth';
import { notFound } from '@/lib/problem-details';
import { softDeleteUser } from '@/services/auth/admin-auth.service';
import { AuthError } from '@/services/auth/service';
import { z } from 'zod';

const adminSchema = z.object({
  userId: z.string().min(1),
});

export const DELETE = withAuth(async (req: NextRequest, ctx: AuthContext & { params: unknown }) => {
  let targetUserId: string;

  if (ctx.actor.role === 'SUPER_ADMIN') {
    // Admin can delete any user specified in body, or themselves if no body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    const parsed = adminSchema.safeParse(body);
    targetUserId = parsed.success ? parsed.data.userId : ctx.actor.id;
  } else {
    // Non-admin can only delete themselves
    targetUserId = ctx.actor.id;
  }

  try {
    await softDeleteUser(targetUserId);
    return NextResponse.json({ data: { deleted: true, userId: targetUserId } });
  } catch (err) {
    if (err instanceof AuthError && err.code === 'not_found') {
      return NextResponse.json(notFound('not_found', 'User not found'), {
        status: 404,
        headers: { 'Content-Type': 'application/problem+json' },
      });
    }
    throw err;
  }
});
