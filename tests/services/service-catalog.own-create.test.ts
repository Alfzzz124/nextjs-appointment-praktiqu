/**
 * Where a psychologist's own new service goes. The clinic list is mocked here; its query is
 * covered on the test DB in tests/integration/services/practice-clinics.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const kc = vi.hoisted(() => ({ listPracticeClinics: vi.fn() }));
vi.mock('@/services/billing/kc-actor', () => kc);

import { resolveOwnCreateTarget } from '@/services/service-catalog/own-create';

const SELF = 34n;
const one = [{ id: 4, name: 'AzaniDianda.com' }];
const two = [{ id: 5, name: 'Klinik A' }, { id: 44, name: 'Klinik B' }];

beforeEach(() => {
  kc.listPracticeClinics.mockReset();
  kc.listPracticeClinics.mockResolvedValue(one);
});

describe('resolveOwnCreateTarget', () => {
  it('uses the only clinic when none is named', async () => {
    expect(await resolveOwnCreateTarget({ self: SELF, doctorIds: [34] })).toEqual({ clinicId: 4 });
    expect(kc.listPracticeClinics).toHaveBeenCalledWith(SELF);
  });

  it('accepts a duplicated self id', async () => {
    expect(await resolveOwnCreateTarget({ self: SELF, doctorIds: [34, 34] })).toEqual({ clinicId: 4 });
  });

  it('refuses a body naming another psychologist, before reading any clinic', async () => {
    expect(await resolveOwnCreateTarget({ self: SELF, doctorIds: [34, 35] })).toEqual({ refusal: 'not_self' });
    expect(kc.listPracticeClinics).not.toHaveBeenCalled();
  });

  it('asks for a clinic when there is more than one', async () => {
    kc.listPracticeClinics.mockResolvedValue(two);
    expect(await resolveOwnCreateTarget({ self: SELF, doctorIds: [34] })).toEqual({ refusal: 'clinic_required' });
  });

  it('takes a named clinic they practise at', async () => {
    kc.listPracticeClinics.mockResolvedValue(two);
    expect(await resolveOwnCreateTarget({ self: SELF, doctorIds: [34], clinicId: 44 })).toEqual({ clinicId: 44 });
  });

  it('refuses a named clinic they do not practise at, even with a single clinic', async () => {
    expect(await resolveOwnCreateTarget({ self: SELF, doctorIds: [34], clinicId: 99 })).toEqual({
      refusal: 'clinic_not_yours',
    });
  });

  it('refuses a psychologist with no active clinic at all', async () => {
    kc.listPracticeClinics.mockResolvedValue([]);
    expect(await resolveOwnCreateTarget({ self: SELF, doctorIds: [34], clinicId: 4 })).toEqual({ refusal: 'no_clinic' });
  });
});
