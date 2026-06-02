/**
 * WordPress authentication service.
 *
 * Wraps the `praktiqu-endpoint` WordPress plugin REST contract. WP is the
 * SOLE source of truth for credentials (FR-027). We never hold a password
 * column on the PraktiQU User.
 *
 * Endpoints (per spec):
 *   POST /wp-json/praktiqu/v1/authenticate           — login
 *   GET  /wp-json/praktiqu/v1/users/{id}             — fetch by WP user ID
 *   POST /wp-json/praktiqu/v1/users/lookup           — fetch by email
 *   POST /wp-json/praktiqu/v1/users/{id}/change-password
 *   POST /wp-json/praktiqu/v1/users                  — self-register (FR-022)
 *   GET  /wp-json/praktiqu/v1/health
 *
 * All requests carry the `X-PraktiQU-Service-Token` header.
 * Network errors map to a 503 result so callers can surface "service unavailable"
 * cleanly. Auth failures are reported with explicit `invalid_credentials` /
 * `inactive` / `blocked` codes.
 */

import { z } from 'zod';
import { highestPraktiQURole, type WpRoleSlug } from './role-mapping';
import { UserRole } from '@prisma/client';

const WP_URL = process.env.WORDPRESS_URL ?? 'http://localhost:9001';
const WP_TOKEN = process.env.WORDPRESS_SERVICE_TOKEN ?? '';

// ─── Schemas ─────────────────────────────────────────────────────────────

export const WpAuthSuccessSchema = z.object({
  wpUserId: z.union([z.number(), z.string()]).transform((v) => BigInt(v)),
  email: z.string().email(),
  username: z.string(),
  displayName: z.string(),
  firstName: z.string().optional().default(''),
  lastName: z.string().optional().default(''),
  roles: z.array(z.string()).default([]),
  status: z.union([z.literal('active'), z.literal('inactive'), z.literal('blocked')]).default('active'),
  passwordChangedAt: z.string().optional(),
  registeredAt: z.string().optional(),
});

export type WpAuthSuccess = z.infer<typeof WpAuthSuccessSchema>;

export type WpAuthError =
  | { code: 'invalid_credentials' }
  | { code: 'inactive' }
  | { code: 'blocked' }
  | { code: 'network_error' }
  | { code: 'service_unavailable' };

export type WpAuthResult =
  | { ok: true; user: WpAuthSuccess }
  | { ok: false; error: WpAuthError };

// ─── Helpers ─────────────────────────────────────────────────────────────

function buildHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-PraktiQU-Service-Token': WP_TOKEN,
  };
}

function normaliseUrl(path: string): string {
  const base = WP_URL.replace(/\/$/, '');
  return `${base}/wp-json/praktiqu/v1${path}`;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await promise;
  } finally {
    clearTimeout(t);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────

/** Authenticate a user against WordPress. */
export async function wpAuthenticate(email: string, password: string): Promise<WpAuthResult> {
  if (!WP_TOKEN) {
    return { ok: false, error: { code: 'service_unavailable' } };
  }
  let res: Response;
  try {
    res = await withTimeout(
      fetch(normaliseUrl('/authenticate'), {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ email, password }),
        cache: 'no-store',
      }),
      5000,
    );
  } catch {
    return { ok: false, error: { code: 'network_error' } };
  }

  if (res.status === 200) {
    const json = await res.json().catch(() => null);
    const parsed = WpAuthSuccessSchema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, error: { code: 'service_unavailable' } };
    }
    return { ok: true, user: parsed.data };
  }

  if (res.status === 401) return { ok: false, error: { code: 'invalid_credentials' } };
  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    if (body.code === 'blocked') return { ok: false, error: { code: 'blocked' } };
    return { ok: false, error: { code: 'inactive' } };
  }
  if (res.status >= 500) return { ok: false, error: { code: 'service_unavailable' } };
  return { ok: false, error: { code: 'invalid_credentials' } };
}

/** Look up a WP user by ID. */
export async function wpGetUser(wpUserId: number | bigint): Promise<WpAuthSuccess | null> {
  if (!WP_TOKEN) return null;
  try {
    const res = await withTimeout(
      fetch(normaliseUrl(`/users/${wpUserId}`), { method: 'GET', headers: buildHeaders(), cache: 'no-store' }),
      5000,
    );
    if (!res.ok) return null;
    const json = await res.json();
    const parsed = WpAuthSuccessSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Look up a WP user by email. */
export async function wpLookupByEmail(email: string): Promise<WpAuthSuccess | null> {
  if (!WP_TOKEN) return null;
  try {
    const res = await withTimeout(
      fetch(normaliseUrl('/users/lookup'), {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ email }),
        cache: 'no-store',
      }),
      5000,
    );
    if (!res.ok) return null;
    const json = await res.json();
    const parsed = WpAuthSuccessSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Change a password in WordPress. Returns true on success. */
export async function wpChangePassword(
  wpUserId: number | bigint,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: 'network_error' | 'service_unavailable' | 'rejected' }> {
  if (!WP_TOKEN) return { ok: false, error: 'service_unavailable' };
  try {
    const res = await withTimeout(
      fetch(normaliseUrl(`/users/${wpUserId}/change-password`), {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ password: newPassword }),
        cache: 'no-store',
      }),
      5000,
    );
    if (res.ok) return { ok: true };
    if (res.status >= 500) return { ok: false, error: 'service_unavailable' };
    return { ok: false, error: 'rejected' };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}

/** Self-register a CLIENT in WordPress. Returns the new WP user id, or null on failure. */
export async function wpRegisterClient(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}): Promise<{ ok: true; wpUser: WpAuthSuccess } | { ok: false; error: 'duplicate' | 'network_error' | 'service_unavailable' | 'rejected' }> {
  if (!WP_TOKEN) return { ok: false, error: 'service_unavailable' };
  try {
    const res = await withTimeout(
      fetch(normaliseUrl('/users'), {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(input),
        cache: 'no-store',
      }),
      5000,
    );
    if (res.status === 201 || res.status === 200) {
      const json = await res.json();
      const parsed = WpAuthSuccessSchema.safeParse(json);
      if (parsed.success) return { ok: true, wpUser: parsed.data };
    }
    if (res.status === 409) return { ok: false, error: 'duplicate' };
    if (res.status >= 500) return { ok: false, error: 'service_unavailable' };
    return { ok: false, error: 'rejected' };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}

/** Liveness probe. */
export async function wpHealth(): Promise<boolean> {
  if (!WP_TOKEN) return false;
  try {
    const res = await withTimeout(
      fetch(normaliseUrl('/health'), { method: 'GET', headers: buildHeaders(), cache: 'no-store' }),
      3000,
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Derive the PraktiQU canonical role from the WP roles array. */
export function derivePraktiQURole(wpRoles: readonly string[]): UserRole {
  return highestPraktiQURole(wpRoles);
}

/** Convert `WpAuthSuccess` to a partial Prisma `User` upsert shape. */
export function toUserUpsertData(wp: WpAuthSuccess, fallbackRole: UserRole = UserRole.CLIENT) {
  const role = derivePraktiQURole(wp.roles as readonly WpRoleSlug[]);
  return {
    where: { wpUserId: wp.wpUserId },
    update: {
      email: wp.email,
      username: wp.username,
      firstName: wp.firstName,
      lastName: wp.lastName,
      displayName: wp.displayName,
      role,
      wpRole: wp.roles[0] ?? null,
      status: wp.status === 'active' ? 1 : 0,
    },
    create: {
      wpUserId: wp.wpUserId,
      email: wp.email,
      username: wp.username,
      firstName: wp.firstName,
      lastName: wp.lastName,
      displayName: wp.displayName,
      role,
      wpRole: wp.roles[0] ?? null,
      status: wp.status === 'active' ? 1 : 0,
      // Use fallback role for new users (default CLIENT) so a freshly synced
      // user gets a safe default; explicit role assignment happens after.
      ...(role === UserRole.CLIENT ? {} : { role: fallbackRole }),
    },
  };
}
