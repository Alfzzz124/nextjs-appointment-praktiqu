/**
 * GET /api/v1/practices/:id/payment-settings — the clinic's international payment settings
 * PUT /api/v1/practices/:id/payment-settings — replace them (written through the plugin)
 *
 * Spec: docs/superpowers/specs/2026-10-06-international-clinic-payment-design.md §3.
 *
 * A separate route on purpose, not part of PATCH /practices/:id/settings: that one writes
 * `extra` and records `actorId: null`, while money settings need a clear audit trail.
 *
 * Access: SUPER_ADMIN for any clinic, CLINIC_ADMIN for their own (another clinic is 404).
 * `assertPracticeInScope` does not check that the clinic exists for a SUPER_ADMIN, so both
 * verbs load it with `findClinicById` first: a PUT for an unknown id never reaches the
 * plugin and never creates an option.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRoles } from '@/lib/auth/route-guards';
import { KcError } from '@/lib/kc-response';
import { logging } from '@/lib/logging';
import {
  badGateway,
  badRequest,
  forbidden,
  notFound,
  problem,
  problemHeaders,
  serviceUnavailable,
  validationError,
  type ProblemDetails,
} from '@/lib/problem-details';
import { WpEndpointError } from '@/lib/wp-endpoint';
import { findClinicById } from '@/repositories/wp/clinics.repo';
import { PaymentSettingsUnavailableError } from '@/repositories/wp/clinic-payment-settings.repo';
import { PracticeNotFoundError, assertPracticeInScope } from '@/services/practice/service';
import {
  FxRateRequiredError,
  PaymentSettingsValidationError,
  getPaymentSettingsView,
  updatePaymentSettings,
} from '@/services/practice/payment-settings.service';

export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

function problemResponse(p: ProblemDetails): NextResponse {
  return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
}

/** Scope first (it rejects a non-integer id), then existence. Throws PracticeNotFoundError. */
async function loadClinicInScope(actor: Parameters<typeof assertPracticeInScope>[0], clinicId: number): Promise<void> {
  await assertPracticeInScope(actor, clinicId);
  if (!(await findClinicById(BigInt(clinicId)))) throw new PracticeNotFoundError(clinicId);
}

async function handleError(err: unknown, clinicId: string, method: 'GET' | 'PUT'): Promise<NextResponse> {
  if (err instanceof PracticeNotFoundError) {
    return problemResponse(notFound('practice_not_found', `Practice ${clinicId} not found.`));
  }
  if (err instanceof KcError) {
    // resolveKcActor: a clinic admin whose account has no WordPress link.
    return problemResponse(forbidden('forbidden', err.message));
  }
  if (err instanceof PaymentSettingsValidationError) {
    return problemResponse(validationError('invalid_input', 'Invalid payment settings', undefined, err.fields));
  }
  if (err instanceof FxRateRequiredError) {
    return problemResponse(validationError('fx_rate_required', err.message, undefined, { fxRate: [err.message] }));
  }
  if (err instanceof PaymentSettingsUnavailableError) {
    await logging.error('Clinic payment settings read failed', err, {
      path: `/api/v1/practices/${clinicId}/payment-settings`,
      method,
    });
    return problemResponse(
      serviceUnavailable('payment_settings_unavailable', 'Payment settings are temporarily unavailable. Please try again.'),
    );
  }
  if (err instanceof WpEndpointError) {
    if (err.code === 'clinic_not_found') {
      return problemResponse(notFound('practice_not_found', `Practice ${clinicId} not found.`));
    }
    if (err.code === 'invalid_settings') {
      // The plugin's own validate() refused what our schema passed. Retrying would fail
      // the same way, so this is a 422 like our own schema failure, not a retryable 502.
      // The WordPress message (it names the field) is logged, never returned.
      await logging.error('Clinic payment settings refused by WordPress', err, {
        path: `/api/v1/practices/${clinicId}/payment-settings`,
        method,
        metadata: { status: err.status, code: err.code },
      });
      return problemResponse(
        validationError('invalid_input', 'Invalid payment settings', undefined, {
          body: ['WordPress rejected the settings'],
        }),
      );
    }
    // The WordPress message is logged, never returned.
    await logging.error('Clinic payment settings save failed', err, {
      path: `/api/v1/practices/${clinicId}/payment-settings`,
      method,
      metadata: { status: err.status, code: err.code ?? null },
    });
    return problemResponse(badGateway('payment_settings_save_failed', 'The settings could not be saved. Please try again.'));
  }
  await logging.error('Clinic payment settings request failed', err, {
    path: `/api/v1/practices/${clinicId}/payment-settings`,
    method,
  });
  // The neighbouring settings route's body, plus a `code` so the FE can always branch on one.
  return problemResponse(
    problem({ type: '/errors/internal', title: 'Internal Server Error', status: 500, code: 'internal_error' }),
  );
}

/** GET /api/v1/practices/:id/payment-settings */
export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;

  const clinicId = Number(params.id);
  try {
    await loadClinicInScope(gate.actor, clinicId);
    const view = await getPaymentSettingsView(clinicId);
    return NextResponse.json({ data: view }, { status: 200 });
  } catch (err) {
    return handleError(err, params.id, 'GET');
  }
}

/** PUT /api/v1/practices/:id/payment-settings */
export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return problemResponse(badRequest('invalid_json', 'The request body must be JSON.'));
  }

  const clinicId = Number(params.id);
  try {
    await loadClinicInScope(gate.actor, clinicId);
    const view = await updatePaymentSettings(clinicId, body, gate.actor);
    return NextResponse.json({ data: view }, { status: 200 });
  } catch (err) {
    return handleError(err, params.id, 'PUT');
  }
}
