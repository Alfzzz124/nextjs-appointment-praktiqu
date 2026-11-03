/**
 * The owner-mode allowlist. A route NOT listed here keeps seeing a plain PROFESSIONAL
 * even when the psychologist is in owner mode — that is what keeps other psychologists'
 * clinical records closed (spec K4). New routes are closed by default.
 */
import { describe, expect, it } from 'vitest';
import { asClinicManager, isOwnerRoute } from '@/lib/auth/owner-routes';

describe('isOwnerRoute — operational routes are elevated', () => {
  it.each([
    ['GET', '/api/v1/services'],
    ['POST', '/api/v1/services'],
    ['PUT', '/api/v1/services/488'],
    ['DELETE', '/api/v1/services/488'],
    ['GET', '/api/v1/professional-sessions'],
    ['POST', '/api/v1/professional-sessions'],
    ['PUT', '/api/v1/professional-sessions/12'],
    ['PUT', '/api/v1/professional-sessions/week'],
    ['GET', '/api/v1/professional-sessions/grouped'],
    ['GET', '/api/v1/doctor-sessions/export'],
    ['POST', '/api/v1/doctor-sessions/bulk/delete'],
    ['GET', '/api/v1/sessions'],
    ['GET', '/api/v1/sessions/calendar'],
    ['GET', '/api/v1/sessions/77'],
    ['POST', '/api/v1/sessions/77/approve'],
    ['POST', '/api/v1/sessions/77/check-out'],
    ['POST', '/api/v1/sessions/bulk/delete'],
    ['GET', '/api/v1/clients'],
    ['POST', '/api/v1/clients'],
    ['PATCH', '/api/v1/clients/9'],
    ['DELETE', '/api/v1/clients/9'],
    ['PATCH', '/api/v1/clients/9/status'],
    ['POST', '/api/v1/clients/bulk/status'],
    ['GET', '/api/v1/bills'],
    ['GET', '/api/v1/bills/3'],
    ['GET', '/api/v1/dashboard/statistics'],
    ['GET', '/api/v1/dashboard/revenue-chart'],
    ['get', '/api/v1/services/'],
  ])('%s %s', (method, path) => {
    expect(isOwnerRoute(method, path)).toBe(true);
  });
});

describe('isOwnerRoute — clinical, configuration and unknown routes stay PROFESSIONAL', () => {
  it.each([
    ['GET', '/api/v1/encounters'],
    ['POST', '/api/v1/encounters'],
    ['GET', '/api/v1/sessions/77/notes'],
    ['GET', '/api/v1/sessions/77/summary'],
    ['GET', '/api/v1/sessions/77/attachments/5/content'],
    ['PUT', '/api/v1/sessions/77/custom-fields'],
    ['GET', '/api/v1/clients/9/custom-fields'],
    ['GET', '/api/v1/clients/9/statistics'],
    ['GET', '/api/v1/patient-medical-reports'],
    ['GET', '/api/v1/medical-history'],
    ['GET', '/api/v1/prescriptions'],
    ['GET', '/api/v1/follow-ups'],
    ['GET', '/api/v1/bills/by-encounter/4'],
    ['GET', '/api/v1/bills/encounters-without-bill'],
    ['DELETE', '/api/v1/bills/item/4'],
    ['GET', '/api/v1/practices/4/settings'],
    ['PATCH', '/api/v1/practices/4'],
    ['PUT', '/api/v1/practices/4/payment-settings'],
    ['GET', '/api/v1/practices/4/holidays'],
    ['PUT', '/api/v1/practices/4/owners'],
    ['GET', '/api/v1/receptionists'],
    ['GET', '/api/v1/professionals'],
    ['PATCH', '/api/v1/professionals/12'],
    ['GET', '/api/v1/clinic-schedules'],
    ['POST', '/api/v1/sessions'],
    ['PATCH', '/api/v1/services/488'],
    ['GET', '/api/v1/services/abc'],
    ['GET', '/api/v1/services-extra'],
    ['GET', '/api/v1/sessions/export'],
    ['GET', '/api/v1/sessions/pending'],
    ['GET', '/api/v1/clients/export'],
    ['HEAD', '/api/v1/services'],
    ['GET', '/api/v1/sessions/077'],
    ['GET', '/api/v1/sessions/77/notes/'],
    ['GET', '/api/v1//sessions'],
  ])('%s %s', (method, path) => {
    expect(isOwnerRoute(method, path)).toBe(false);
  });
});

describe('asClinicManager', () => {
  it('acts as CLINIC_ADMIN of exactly that clinic, keeping identity', () => {
    const actor = { id: 'u1', role: 'PROFESSIONAL' as const, practiceId: null, ownerClinicId: 4n };
    expect(asClinicManager(actor, 4n)).toEqual({
      id: 'u1', role: 'CLINIC_ADMIN', practiceId: null, activeClinicId: 4n, ownerClinicId: 4n,
    });
  });
});
