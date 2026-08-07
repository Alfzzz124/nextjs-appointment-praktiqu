/**
 * Plan a backfill of `users` rows from `wp_users`.
 *
 * A `users` row is only created when someone logs into the app, but WordPress accounts
 * come from elsewhere too — every guest booking makes one. That leaves people with a real
 * account and no app row, invisible to anything that reads `users`.
 *
 * This module decides what to write; it touches nothing. Keeping the decisions pure is
 * what makes the messy parts testable: staging has accounts with no email, two accounts
 * sharing an address, and a duplicated login, and both `users.email` and `users.username`
 * are unique — so a naive insert dies partway and leaves the job half done.
 *
 * `role` here is the role WordPress actually grants, not the conservative CLIENT default
 * that `toUserUpsertData` writes for freshly synced logins. A backfill exists to mirror
 * WordPress; writing 30 privileged accounts as CLIENT would make the table lie. It grants
 * nothing new either — logging in derives the same role.
 */

import { UserRole } from '@prisma/client';
import { highestPraktiQURole, WP_ROLES, type WpRoleSlug } from './role-mapping';

/** One `wp_users` row plus the `wp_usermeta` values the mapping needs. */
export interface WpUserRow {
  id: number;
  email: string;
  /** `wp_users.user_login`. */
  login: string;
  displayName: string;
  firstName: string;
  lastName: string;
  /** Serialised `wp_capabilities` meta. */
  capabilities: string;
  /** `praktiqu_client_status` meta: ACTIVE | INACTIVE | ARCHIVED, or null if unset. */
  clientStatus: string | null;
}

export interface PlannedUser {
  wpUserId: bigint;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  displayName: string;
  role: UserRole;
  wpRole: string | null;
  status: number;
}

export type SkipReason = 'no_email' | 'duplicate_email' | 'email_taken';

export interface SkippedUser {
  id: number;
  email: string;
  reason: SkipReason;
}

export interface BackfillPlan {
  insert: PlannedUser[];
  skip: SkippedUser[];
}

/** Every role slug we can recognise, longest first so `clinic_admin` wins over `admin`. */
const KNOWN_SLUGS: WpRoleSlug[] = [
  WP_ROLES.CLINIC_ADMIN,
  WP_ROLES.RECEPTIONIST,
  WP_ROLES.DOCTOR,
  WP_ROLES.PATIENT,
  WP_ROLES.ADMIN,
] as WpRoleSlug[];

/**
 * Pull role slugs out of the serialised `wp_capabilities` blob.
 *
 * Substring matching rather than unserialising PHP: we only care whether a known slug is
 * present, and the blob's exact shape is WordPress's business.
 */
function slugsFrom(capabilities: string): WpRoleSlug[] {
  return KNOWN_SLUGS.filter((slug) => capabilities.includes(`"${slug}"`));
}

export function planBackfill(
  rows: readonly WpUserRow[],
  taken: { usernames: Set<string>; emails: Set<string> },
): BackfillPlan {
  const insert: PlannedUser[] = [];
  const skip: SkippedUser[] = [];

  // Oldest account wins a contested email — it is the one with history behind it.
  const byAge = [...rows].sort((a, b) => a.id - b.id);

  const usedEmails = new Set(taken.emails);
  const usedUsernames = new Set(taken.usernames);

  for (const row of byAge) {
    const email = row.email.trim().toLowerCase();

    if (!email) {
      skip.push({ id: row.id, email: '', reason: 'no_email' });
      continue;
    }
    if (usedEmails.has(email)) {
      // Already claimed — either by an existing app user or by an older row in this batch.
      skip.push({
        id: row.id,
        email,
        reason: taken.emails.has(email) ? 'email_taken' : 'duplicate_email',
      });
      continue;
    }
    usedEmails.add(email);

    // A login collision is not worth losing an account over; the WP id makes it unique.
    let username = row.login;
    if (usedUsernames.has(username)) username = `${row.login}_${row.id}`;
    usedUsernames.add(username);

    const slugs = slugsFrom(row.capabilities);
    const displayName =
      row.displayName.trim() || `${row.firstName} ${row.lastName}`.trim() || email;

    insert.push({
      wpUserId: BigInt(row.id),
      email,
      username,
      firstName: row.firstName,
      lastName: row.lastName,
      displayName,
      role: highestPraktiQURole(slugs),
      wpRole: slugs[0] ?? null,
      status: row.clientStatus === 'INACTIVE' || row.clientStatus === 'ARCHIVED' ? 0 : 1,
    });
  }

  return { insert, skip };
}
