/**
 * RFC 7807 Problem Details for HTTP APIs.
 *
 * Source: https://www.rfc-editor.org/rfc/rfc7807
 * Per FR-013: all error responses MUST use this format.
 *
 * Shape:
 *   {
 *     "type":      "https://praktiqu.example.com/problems/invalid-credentials",
 *     "title":     "Invalid credentials",
 *     "status":    401,
 *     "detail":    "Email or password is incorrect",
 *     "instance":  "/api/v1/auth/login",
 *     "code":      "invalid_credentials"     // app-specific error code
 *   }
 *
 * Per spec, error responses include a `Retry-After` header on 429 responses.
 */

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
  [extension: string]: unknown;
}

const PROBLEM_BASE = process.env.PROBLEM_TYPE_BASE ?? 'https://praktiqu.example.com/problems';

function problemUri(slug: string): string {
  return `${PROBLEM_BASE}/${slug}`;
}

/** Build a Problem Details object. */
export function problem(
  init: {
    type: string;
    title: string;
    status: number;
    code: string;
    detail?: string;
    instance?: string;
  } & Record<string, unknown>,
): ProblemDetails {
  return init as ProblemDetails;
}

/** 400 — bad request. */
export function badRequest(code: string, detail?: string, instance?: string): ProblemDetails {
  return problem({
    type: problemUri('bad-request'),
    title: 'Bad Request',
    status: 400,
    code,
    detail,
    instance,
  });
}

/** 401 — unauthenticated. */
export function unauthorized(code = 'unauthorized', detail?: string, instance?: string): ProblemDetails {
  return problem({
    type: problemUri('unauthorized'),
    title: 'Unauthorized',
    status: 401,
    code,
    detail,
    instance,
  });
}

/** 403 — forbidden. */
export function forbidden(code = 'forbidden', detail?: string, instance?: string): ProblemDetails {
  return problem({
    type: problemUri('forbidden'),
    title: 'Forbidden',
    status: 403,
    code,
    detail,
    instance,
  });
}

/** 404 — not found. */
export function notFound(code = 'not_found', detail?: string, instance?: string): ProblemDetails {
  return problem({
    type: problemUri('not-found'),
    title: 'Not Found',
    status: 404,
    code,
    detail,
    instance,
  });
}

/** 409 — conflict (e.g. duplicate email). */
export function conflict(code: string, detail?: string, instance?: string): ProblemDetails {
  return problem({
    type: problemUri('conflict'),
    title: 'Conflict',
    status: 409,
    code,
    detail,
    instance,
  });
}

/** 422 — validation error. */
export function validationError(code: string, detail?: string, instance?: string, fields?: Record<string, string[]>): ProblemDetails {
  return problem({
    type: problemUri('validation-error'),
    title: 'Validation Error',
    status: 422,
    code,
    detail,
    instance,
    ...(fields ? { fields } : {}),
  });
}

/** 429 — rate limit. */
export function tooManyRequests(
  code: string,
  retryAfterSeconds: number,
  detail?: string,
  instance?: string,
): ProblemDetails {
  return problem({
    type: problemUri('rate-limited'),
    title: 'Too Many Requests',
    status: 429,
    code,
    detail,
    instance,
    retryAfter: retryAfterSeconds,
  });
}

/** 503 — service unavailable. */
export function serviceUnavailable(code = 'service_unavailable', detail?: string, instance?: string): ProblemDetails {
  return problem({
    type: problemUri('service-unavailable'),
    title: 'Service Unavailable',
    status: 503,
    code,
    detail,
    instance,
  });
}

/** Convert a ProblemDetails to a Headers object (including Retry-After for 429). */
export function problemHeaders(p: ProblemDetails): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/problem+json',
  };
  if (p.status === 429 && typeof p['retryAfter'] === 'number') {
    headers['Retry-After'] = String(p['retryAfter']);
  }
  return headers;
}
