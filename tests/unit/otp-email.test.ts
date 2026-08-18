/**
 * The sign-in code email.
 *
 * The template lives in code on purpose. KiviCare's registration template lives in the
 * WordPress database, and that is how a plaintext password ended up being mailed to
 * patients — nobody reviewing the repo could see it.
 */
import { describe, it, expect } from 'vitest';
import { buildOtpEmail } from '@/lib/email';

describe('buildOtpEmail', () => {
  const mail = buildOtpEmail({ code: '418902', ttlMinutes: 10 });

  it('puts the code in the subject, so it is readable from a notification', () => {
    expect(mail.subject).toContain('418902');
  });

  it('puts the code in the html body', () => {
    expect(mail.html).toContain('418902');
  });

  it('puts the code in the plain-text body', () => {
    expect(mail.text).toContain('418902');
  });

  it('tells the reader how long it lasts', () => {
    expect(mail.text).toContain('10');
  });

  it('tells the reader what to do if it was not them', () => {
    expect(mail.text.toLowerCase()).toContain('ignore');
  });

  it('carries no link — a code email that also contains a link trains people to click', () => {
    expect(mail.html).not.toContain('<a ');
  });
});
