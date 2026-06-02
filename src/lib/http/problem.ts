/**
 * RFC 7807 problem-detail response helper.
 *
 * Single place to format error responses so every route returns a consistent
 * shape with `content-type: application/problem+json`.
 */

import { NextResponse } from 'next/server';
import { InterventionPlanError } from '@/services/intervention-plan/service';

export function problemResponse(err: InterventionPlanError): NextResponse {
  return NextResponse.json(
    {
      type: 'about:blank',
      title: err.code,
      status: err.status,
      detail: err.message,
      ...(err.details ? { 'invalid-params': err.details } : {}),
    },
    { status: err.status, headers: { 'content-type': 'application/problem+json' } },
  );
}

export function validationProblemResponse(flattened: unknown): NextResponse {
  return NextResponse.json(
    { type: 'about:blank', title: 'validation_failed', status: 400, 'invalid-params': flattened },
    { status: 400, headers: { 'content-type': 'application/problem+json' } },
  );
}
