/**
 * GET /api/v1/practices/:id/owners — the clinic's active psychologists, with who owns it
 * PUT /api/v1/practices/:id/owners — replace the manually ticked owners
 *
 * SUPER_ADMIN for any clinic; CLINIC_ADMIN for their active clinic only (404 otherwise,
 * via assertPracticeInScope). A psychologist — owner or not — cannot change owners: that
 * is clinic configuration, which owner mode deliberately leaves out.
 * See src/services/clinic-owner/service.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRoles } from '@/lib/auth/route-guards';
import { KcError } from '@/lib/kc-response';
import { prisma } from '@/lib/db';
import { PracticeNotFoundError, assertPracticeInScope } from '@/services/practice/service';
import {
  NotAClinicProfessionalError,
  listClinicOwnerRoster,
  setClinicOwners,
} from '@/services/clinic-owner/service';

type Params = { params: { id: string } };

const bodySchema = z.object({ doctorIds: z.array(z.number().int().positive()).max(500) });

const notFound = () =>
  NextResponse.json({ type: '/errors/resource-not-found', title: 'Practice not found', status: 404 }, { status: 404 });

const CLINIC_ID = /^[1-9][0-9]{0,18}$/;

/**
 * The gate shared by both verbs: role, then a strict id, then scope, then existence.
 * Returns the caller and clinic to carry on with, or a ready-made response to send.
 * Malformed, out-of-scope and nonexistent ids all answer the same 404.
 */
async function gate(
  req: NextRequest,
  id: string,
): Promise<{ actorId: string; clinicId: bigint; clinicName: string } | NextResponse> {
  const g = await requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in g) return g.response;
  // Number() would accept "1e3" and BigInt() would then throw: refuse anything but plain digits.
  if (!CLINIC_ID.test(id)) return notFound();
  try {
    await assertPracticeInScope(g.actor, Number(id));
  } catch (err) {
    if (err instanceof PracticeNotFoundError) return notFound();
    if (err instanceof KcError) {
      return NextResponse.json(
        { type: '/errors/forbidden', title: 'Forbidden', status: err.httpStatus, detail: err.message },
        { status: err.httpStatus },
      );
    }
    throw err;
  }
  const clinicId = BigInt(id);
  const clinic = await prisma.kcClinic.findUnique({ where: { id: clinicId }, select: { name: true } });
  if (!clinic) return notFound();
  return { actorId: g.actor.id, clinicId, clinicName: clinic.name?.trim() || `Klinik #${clinicId}` };
}

function payload(g: { clinicId: bigint; clinicName: string }, roster: Awaited<ReturnType<typeof listClinicOwnerRoster>>) {
  return { clinic: { id: Number(g.clinicId), name: g.clinicName }, data: roster };
}

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const g = await gate(req, params.id);
  if (g instanceof NextResponse) return g;
  return NextResponse.json(payload(g, await listClinicOwnerRoster(g.clinicId)));
}

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const g = await gate(req, params.id);
  if (g instanceof NextResponse) return g;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ type: '/errors/bad-request', title: 'Invalid JSON', status: 400 }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { type: '/errors/validation-error', title: 'Validation Error', status: 422, fields: { doctorIds: ['doctorIds must be an array of positive integers'] } },
      { status: 422 },
    );
  }

  try {
    const roster = await setClinicOwners(g.clinicId, parsed.data.doctorIds, g.actorId);
    return NextResponse.json(payload(g, roster));
  } catch (err) {
    if (err instanceof NotAClinicProfessionalError) {
      return NextResponse.json(
        {
          type: '/errors/validation-error',
          title: 'Validation Error',
          status: 422,
          fields: { doctorIds: [`Not an active psychologist of this clinic: ${err.doctorIds.join(', ')}`] },
        },
        { status: 422 },
      );
    }
    throw err;
  }
}
