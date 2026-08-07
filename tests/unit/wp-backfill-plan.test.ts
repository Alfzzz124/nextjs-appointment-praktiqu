/**
 * planBackfill — turning wp_users rows into `users` rows.
 *
 * The staging data is not clean: two accounts have no email, two share an address, and
 * one login is duplicated. `users.email` and `users.username` are both unique, so a naive
 * insert dies partway through and leaves the backfill half-applied. The planner decides
 * what to write and what to leave alone BEFORE anything touches the database.
 */
import { describe, it, expect } from 'vitest';
import { planBackfill, type WpUserRow } from '@/lib/auth/wp-backfill';

const NOTHING_TAKEN = { usernames: new Set<string>(), emails: new Set<string>() };

function row(over: Partial<WpUserRow> = {}): WpUserRow {
  return {
    id: 100,
    email: 'budi@example.com',
    login: 'budi',
    displayName: 'Budi Santoso',
    firstName: 'Budi',
    lastName: 'Santoso',
    capabilities: 'a:1:{s:16:"kiviCare_patient";b:1;}',
    clientStatus: null,
    ...over,
  };
}

describe('planBackfill', () => {
  it('maps a KiviCare patient to a CLIENT row linked by wpUserId', () => {
    const { insert } = planBackfill([row()], NOTHING_TAKEN);

    expect(insert).toHaveLength(1);
    expect(insert[0]).toMatchObject({
      wpUserId: BigInt(100),
      email: 'budi@example.com',
      username: 'budi',
      firstName: 'Budi',
      lastName: 'Santoso',
      displayName: 'Budi Santoso',
      role: 'CLIENT',
      wpRole: 'kiviCare_patient',
      status: 1,
    });
  });

  it('maps an administrator to SUPER_ADMIN', () => {
    const { insert } = planBackfill(
      [row({ capabilities: 'a:1:{s:13:"administrator";b:1;}' })],
      NOTHING_TAKEN,
    );

    expect(insert[0]?.role).toBe('SUPER_ADMIN');
    expect(insert[0]?.wpRole).toBe('administrator');
  });

  it('maps a clinic admin to CLINIC_ADMIN', () => {
    const { insert } = planBackfill(
      [row({ capabilities: 'a:1:{s:21:"kiviCare_clinic_admin";b:1;}' })],
      NOTHING_TAKEN,
    );

    expect(insert[0]?.role).toBe('CLINIC_ADMIN');
  });

  it('falls back to CLIENT for a role the app does not model', () => {
    const { insert } = planBackfill(
      [row({ capabilities: 'a:1:{s:6:"editor";b:1;}' })],
      NOTHING_TAKEN,
    );

    expect(insert[0]?.role).toBe('CLIENT');
  });

  it('normalises the email so a stray capital cannot create a second account', () => {
    const { insert } = planBackfill([row({ email: '  Budi@Example.COM ' })], NOTHING_TAKEN);

    expect(insert[0]?.email).toBe('budi@example.com');
  });

  it('skips a row with no email, since users.email is required and unique', () => {
    const { insert, skip } = planBackfill([row({ id: 7, email: '   ' })], NOTHING_TAKEN);

    expect(insert).toHaveLength(0);
    expect(skip).toEqual([{ id: 7, email: '', reason: 'no_email' }]);
  });

  it('keeps the oldest account when two rows share an email', () => {
    const { insert, skip } = planBackfill(
      [row({ id: 500, login: 'kembar-b' }), row({ id: 200, login: 'kembar-a' })],
      NOTHING_TAKEN,
    );

    expect(insert).toHaveLength(1);
    expect(insert[0]?.wpUserId).toBe(BigInt(200));
    expect(skip).toEqual([{ id: 500, email: 'budi@example.com', reason: 'duplicate_email' }]);
  });

  it('skips an address that already belongs to an existing app user', () => {
    const { insert, skip } = planBackfill([row({ id: 9 })], {
      usernames: new Set<string>(),
      emails: new Set(['budi@example.com']),
    });

    expect(insert).toHaveLength(0);
    expect(skip[0]?.reason).toBe('email_taken');
  });

  it('suffixes a duplicated login rather than dropping the account', () => {
    const { insert, skip } = planBackfill(
      [
        row({ id: 200, email: 'satu@example.com', login: 'sama' }),
        row({ id: 500, email: 'dua@example.com', login: 'sama' }),
      ],
      NOTHING_TAKEN,
    );

    expect(skip).toHaveLength(0);
    expect(insert.map((u) => u.username)).toEqual(['sama', 'sama_500']);
  });

  it('suffixes a login that an existing app user already holds', () => {
    const { insert } = planBackfill([row({ id: 42, login: 'budi' })], {
      usernames: new Set(['budi']),
      emails: new Set<string>(),
    });

    expect(insert[0]?.username).toBe('budi_42');
  });

  it('marks an archived patient inactive instead of resurrecting them', () => {
    const { insert } = planBackfill([row({ clientStatus: 'ARCHIVED' })], NOTHING_TAKEN);

    expect(insert[0]?.status).toBe(0);
  });

  it('keeps an explicitly active patient active', () => {
    const { insert } = planBackfill([row({ clientStatus: 'ACTIVE' })], NOTHING_TAKEN);

    expect(insert[0]?.status).toBe(1);
  });

  it('falls back to the email for a display name when WordPress has no name', () => {
    const { insert } = planBackfill(
      [row({ displayName: '', firstName: '', lastName: '' })],
      NOTHING_TAKEN,
    );

    expect(insert[0]?.displayName).toBe('budi@example.com');
  });
});
