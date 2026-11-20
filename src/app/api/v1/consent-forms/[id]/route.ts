// src/app/api/v1/consent-forms/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { ConsentService } from '@/services/consent/service';
import { withAuth } from '@/lib/auth';
import { requireAuth, requireRoles } from '@/lib/auth/route-guards';
import { forbidden } from '@/lib/problem-details';
import {
  canReadSignatures,
  consentScopeFor,
  forbiddenResponse,
  formInScope,
  kcErrorResponse,
  notFoundResponse,
} from '@/services/consent/access';

const prisma = new PrismaClient();
const service = new ConsentService(prisma);

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireAuth(req);
  if ('response' in gate) return gate.response;
  const { actor } = gate;
  try {
    const form = await service.getForm(params.id);
    if (!form) return notFoundResponse();

    // Out of scope answers 404, not 403: a cuid should not confirm that a form exists.
    if (actor.role === 'CLIENT') {
      // A patient may open a form only once someone asked them to sign it.
      if (!form.signatures.some((s) => s.clientId === actor.id)) return notFoundResponse();
    } else if (!formInScope(await consentScopeFor(actor), form.practiceId)) {
      return notFoundResponse();
    }

    // The signatures carry every client's name, signature and IP: admins only.
    if (!canReadSignatures(actor)) {
      const { signatures: _signatures, ...withoutSignatures } = form;
      return NextResponse.json(withoutSignatures);
    }
    return NextResponse.json(form);
  } catch (err) {
    const kc = kcErrorResponse(err);
    if (kc) return kc;
    throw err;
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;
  try {
    const body = await req.json();
    if (gate.actor.role !== 'SUPER_ADMIN') {
      const form = await service.getFormPractice(params.id);
      if (!form || !formInScope(await consentScopeFor(gate.actor), form.practiceId)) return notFoundResponse();
      // Moving a form to another clinic would hand it to that clinic's admins.
      if (body?.practiceId !== undefined && body.practiceId !== form.practiceId) {
        return forbiddenResponse('Cannot move a consent form to another clinic');
      }
    }
    const updated = await service.updateForm(params.id, body);
    return NextResponse.json(updated);
  } catch (err: any) {
    const kc = kcErrorResponse(err);
    if (kc) return kc;
    if (err?.name === 'ZodError') return NextResponse.json({ type: 'about:blank', title: 'Validation failed', status: 400 }, { status: 400 });
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}

export const DELETE = withAuth(async (req, ctx) => {
  const { actor } = ctx;
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden(), { status: 403 });
  }
  const { id } = (ctx as any).params;
  try {
    if (actor.role !== 'SUPER_ADMIN') {
      const form = await service.getFormPractice(id);
      if (!form || !formInScope(await consentScopeFor(actor), form.practiceId)) return notFoundResponse();
    }
    await service.deleteForm(id);
    return NextResponse.json({ message: 'Deleted' });
  } catch (err: any) {
    const kc = kcErrorResponse(err);
    if (kc) return kc;
    if (err?.code === 'not_found') return NextResponse.json({ type: 'about:blank', title: 'Not Found', status: 404 }, { status: 404 });
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
});
