// src/app/api/v1/consent-forms/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireRoles } from '@/lib/auth/route-guards';
import { forbidden } from '@/lib/problem-details';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { KcError } from '@/lib/kc-response';
import { PrismaClient } from '@prisma/client';
import {
  consentScopeFor,
  formInScope,
  forbiddenResponse,
  kcErrorResponse,
  CONSENT_STAFF_ROLES,
} from '@/services/consent/access';
import {
  ConsentService,
  ConsentServiceError,
  consentFormCreateSchema,
} from '@/services/consent/service';

const prisma = new PrismaClient();
const service = new ConsentService(prisma);

export async function GET(req: NextRequest) {
  // A form's text and its clinic are staff business; a patient meets a form only through
  // GET /consent-forms/{id}, once a signature request exists for them.
  const gate = await requireRoles(req, CONSENT_STAFF_ROLES);
  if ('response' in gate) return gate.response;

  const { searchParams } = new URL(req.url);
  const practiceId = searchParams.get('practiceId') ?? undefined;
  const status = searchParams.get('status') ?? undefined;
  if (!practiceId) return NextResponse.json({ type: 'about:blank', title: 'Bad Request', status: 400 }, { status: 400 });
  try {
    const scope = await consentScopeFor(gate.actor);
    if (!formInScope(scope, practiceId)) return forbiddenResponse('Cannot list the consent forms of another clinic');
    const forms = await service.listForms(practiceId, status);
    return NextResponse.json({ items: forms });
  } catch (err) {
    const kc = kcErrorResponse(err);
    if (kc) return kc;
    throw err;
  }
}

export async function POST(req: NextRequest) {
  // Same gate as PATCH and DELETE: writing a consent form is an admin's job.
  const gate = await requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;

  try {
    const body = await req.json();
    const parsed = consentFormCreateSchema.parse(body);
    // A CLINIC_ADMIN files forms for their own (active) clinic only.
    if (gate.actor.role === 'CLINIC_ADMIN') {
      const kc = await resolveKcActor(gate.actor);
      if (kc.clinicId === null || parsed.practiceId !== String(kc.clinicId)) {
        return NextResponse.json(forbidden('Cannot create a consent form for another clinic'), { status: 403 });
      }
    }
    const created = await service.createForm(parsed);
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    if (err?.name === 'ZodError') return NextResponse.json({ type: 'about:blank', title: 'Validation failed', status: 400 }, { status: 400 });
    // resolveKcActor refuses an account not linked to WordPress.
    if (err instanceof KcError) {
      return NextResponse.json({ type: 'about:blank', title: err.message, status: err.httpStatus }, { status: err.httpStatus });
    }
    if (err instanceof ConsentServiceError) {
      return NextResponse.json(
        { type: 'about:blank', title: err.code, status: err.status, detail: err.message },
        { status: err.status },
      );
    }
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}