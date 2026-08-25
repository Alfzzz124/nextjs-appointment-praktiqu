/**
 * Unit tests for receptionistCreateSchema.
 *
 * `password` is optional: leave it out and the WordPress plugin generates one, which
 * only ever reaches the receptionist through the welcome email — and
 * POST /receptionists/:id/resend-credentials is still a 501 stub, so a bounced email
 * cannot be retried. These assertions pin the alternative: an admin may supply the
 * password themselves, within bounds.
 */
import { describe, it, expect } from 'vitest';
import { receptionistCreateSchema } from '@/services/billing/validation';

const base = { name: 'Reception One', email: 'reception.one@test.local' };

describe('receptionistCreateSchema', () => {
  it('accepts input without a password — WordPress generates one', () => {
    const parsed = receptionistCreateSchema.parse(base);
    expect(parsed.password).toBeUndefined();
  });

  it('accepts an admin-chosen password', () => {
    expect(receptionistCreateSchema.parse({ ...base, password: 'sandi-kuat-2026' }).password)
      .toBe('sandi-kuat-2026');
  });

  it('rejects a password shorter than 8 characters', () => {
    expect(() => receptionistCreateSchema.parse({ ...base, password: 'pendek' })).toThrow();
  });

  it('rejects a password longer than 64 characters', () => {
    expect(() => receptionistCreateSchema.parse({ ...base, password: 'a'.repeat(65) })).toThrow();
  });

  it('still requires name and email', () => {
    expect(() => receptionistCreateSchema.parse({ password: 'sandi-kuat-2026' })).toThrow();
  });
});
