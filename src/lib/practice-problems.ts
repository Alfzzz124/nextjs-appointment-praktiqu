/**
 * Practice-service errors → problem+json responses, shared by every /practices route that
 * creates, edits, (de)activates or deletes a clinic. `code` is the stable slug the Laravel
 * FE matches on; `title`/`detail` are English and may change.
 *
 * Returns null for anything it does not know, so the route can log it and answer 500.
 */
import { NextResponse } from 'next/server';
import { KcError } from '@/lib/kc-response';
import { ClinicEmailConflictError, ClinicNameConflictError } from '@/services/practice/clinic-names';
import {
  AdminEmailTakenError,
  ClinicAdminProvisionError,
  ClinicNotEmptyError,
  NotAClinicAdminError,
  PracticeNotFoundError,
  PracticeValidationError,
} from '@/services/practice/service';

function problem(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json({ status, ...body }, { status });
}

export function practiceProblem(err: unknown): NextResponse | null {
  if (err instanceof PracticeNotFoundError) {
    return problem(404, {
      type: '/errors/resource-not-found',
      title: 'Practice not found',
      code: 'practice_not_found',
      detail: `Practice ${err.id} does not exist.`,
    });
  }
  if (err instanceof PracticeValidationError) {
    return problem(422, {
      type: '/errors/validation-error',
      title: 'Validation Error',
      code: 'validation_error',
      detail: err.message,
      issues: err.issues,
    });
  }
  if (err instanceof ClinicNameConflictError) {
    return problem(409, {
      type: '/errors/clinic-name-conflict',
      title: 'Clinic name not available',
      code: 'clinic_name_conflict',
      detail: err.message,
      ...err.problem,
    });
  }
  if (err instanceof ClinicEmailConflictError) {
    return problem(409, {
      type: '/errors/clinic-email-conflict',
      title: 'Clinic email already used',
      code: 'clinic_email_conflict',
      detail: err.message,
      conflictId: err.conflictId,
    });
  }
  if (err instanceof AdminEmailTakenError) {
    return problem(409, {
      type: '/errors/admin-email-taken',
      title: 'Admin email already registered',
      code: 'admin_email_taken',
      detail: err.message,
    });
  }
  if (err instanceof NotAClinicAdminError) {
    return problem(422, {
      type: '/errors/validation-error',
      title: 'Not a clinic admin',
      code: 'not_a_clinic_admin',
      detail: err.message,
    });
  }
  if (err instanceof ClinicNotEmptyError) {
    return problem(409, {
      type: '/errors/clinic-not-empty',
      title: 'Clinic still has data',
      code: 'clinic_not_empty',
      detail: err.message,
      counts: err.counts,
    });
  }
  if (err instanceof ClinicAdminProvisionError) {
    return problem(502, {
      type: '/errors/upstream',
      title: 'Admin account could not be created',
      code: 'admin_provision_failed',
      detail: err.message,
    });
  }
  if (err instanceof KcError) {
    return problem(err.httpStatus, { type: '/errors/forbidden', title: 'Forbidden', code: 'forbidden', detail: err.message });
  }
  return null;
}
