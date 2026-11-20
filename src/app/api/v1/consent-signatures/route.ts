// src/app/api/v1/consent-signatures/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/route-guards';
import { PrismaClient } from '@prisma/client';
import { ConsentService } from '@/services/consent/service';
import {
  consentScopeFor,
  forbiddenResponse,
  formInScope,
  kcErrorResponse,
  notFoundResponse,
} from '@/services/consent/access';

const prisma = new PrismaClient();
const service = new ConsentService(prisma);

/** Staff reach only the forms of their clinic; a missing form and a foreign one both 404. */
async function staffCanUseForm(actor: Parameters<typeof consentScopeFor>[0], formId: unknown): Promise<boolean> {
  if (typeof formId !== 'string' || formId === '') return false;
  const form = await service.getFormPractice(formId);
  return !!form && formInScope(await consentScopeFor(actor), form.practiceId);
}

export async function POST(req: NextRequest) {
  const gate = await requireAuth(req);
  if ('response' in gate) return gate.response;
  const { actor } = gate;

  try {
    const body = await req.json();
    if (body.action === 'send') {
      // Asking someone to sign is staff work, on the staff member's own clinic's forms.
      if (actor.role === 'CLIENT') return forbiddenResponse();
      if (!(await staffCanUseForm(actor, body.formId))) return notFoundResponse();
      const sig = await service.sendSignatureRequest(body.formId, body.clientId);
      return NextResponse.json(sig, { status: 201 });
    }
    if (body.status === 'SIGNED' || body.status === 'DECLINED') {
      let clientId = body.clientId;
      if (actor.role === 'CLIENT') {
        // A patient answers for themselves only; the body's clientId is not trusted.
        clientId = actor.id;
        if (!(await service.getFormPractice(String(body.formId ?? '')))) return notFoundResponse();
      } else if (!(await staffCanUseForm(actor, body.formId))) {
        return notFoundResponse();
      }
      const sig = await service.sign(body.formId, clientId, body);
      return NextResponse.json(sig);
    }
    return NextResponse.json({ type: 'about:blank', title: 'Bad Request', status: 400 }, { status: 400 });
  } catch (err: any) {
    const kc = kcErrorResponse(err);
    if (kc) return kc;
    if (err?.name === 'ZodError') return NextResponse.json({ type: 'about:blank', title: 'Validation failed', status: 400 }, { status: 400 });
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const gate = await requireAuth(req);
  if ('response' in gate) return gate.response;
  const { actor } = gate;

  const { searchParams } = new URL(req.url);
  const formId = searchParams.get('formId') ?? '';
  let clientId = searchParams.get('clientId') ?? '';
  try {
    if (actor.role === 'CLIENT') {
      clientId = actor.id;
    } else if (!(await staffCanUseForm(actor, formId))) {
      return notFoundResponse();
    }
    const sig = await service.getSignatureStatus(formId, clientId);
    return NextResponse.json(sig ?? { status: null });
  } catch (err) {
    const kc = kcErrorResponse(err);
    if (kc) return kc;
    throw err;
  }
}
