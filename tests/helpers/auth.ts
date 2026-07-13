/**
 * Test helper: mint a real JWT that the canonical `getActor` (src/lib/auth.ts)
 * will accept. Signs with the same `AUTH_SECRET` the app verifies against
 * (falling back to the same dev default), so integration tests can drive the
 * migrated routes with genuine Bearer auth instead of spoofable headers.
 */

import { SignJWT } from 'jose';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

export interface TestActor {
  userId: string;
  role: 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'PROFESSIONAL' | 'RECEPTIONIST' | 'CLIENT';
  practiceId?: string | null;
}

/** Sign a valid access token for the given actor. */
export async function bearerToken(actor: TestActor): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: actor.role, practiceId: actor.practiceId ?? null })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(actor.userId)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(SECRET);
}

/** Build request headers (Authorization + JSON content-type) for the actor. */
export async function authHeaders(actor: TestActor): Promise<Record<string, string>> {
  return {
    authorization: `Bearer ${await bearerToken(actor)}`,
    'content-type': 'application/json',
  };
}
