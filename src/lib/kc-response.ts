import { NextResponse } from 'next/server';

/** KiviCare {status, message, data} success envelope. Always HTTP 200. */
export function kcOk<T>(data: T, message = ''): NextResponse {
  return NextResponse.json({ status: true, message, data }, { status: 200 });
}

/** KiviCare failure envelope with explicit HTTP status. */
export function kcFail(message: string, httpStatus = 400, data: unknown = null): NextResponse {
  return NextResponse.json({ status: false, message, data }, { status: httpStatus });
}

/** Thrown by services; routes convert it to kcFail. */
export class KcError extends Error {
  constructor(message: string, public httpStatus = 400) {
    super(message);
    this.name = 'KcError';
  }
}

/** Wrap a service call, converting KcError + unknown errors to envelopes. */
export async function kcHandle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof KcError) return kcFail(err.message, err.httpStatus);
    // eslint-disable-next-line no-console
    console.error('[kc] unhandled', err);
    return kcFail('Something went wrong', 500);
  }
}
