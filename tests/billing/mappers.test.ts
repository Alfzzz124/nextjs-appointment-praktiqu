import { describe, it, expect } from 'vitest';
import { metaToMap, fullNameFromMeta, taxRowToApi } from '@/services/billing/mappers';

describe('mappers', () => {
  it('metaToMap collapses rows to a key→value object', () => {
    const map = metaToMap([
      { metaKey: 'first_name', metaValue: 'Jane' },
      { metaKey: 'last_name', metaValue: 'Doe' },
    ]);
    expect(map.first_name).toBe('Jane');
  });

  it('fullNameFromMeta joins first + last', () => {
    expect(fullNameFromMeta({ first_name: 'Jane', last_name: 'Doe' })).toBe('Jane Doe');
  });

  it('taxRowToApi parses value and maps fields', () => {
    const api = taxRowToApi({
      id: 3n, name: 'VAT', taxType: 'percentage', taxValue: '10',
      clinicId: -1n, doctorId: -1n, serviceId: -1n, addedBy: 1n, status: 1,
      createdAt: new Date('2026-01-01'),
    } as any, { actual_service_id: null, serviceName: null });
    expect(api).toMatchObject({ id: 3, name: 'VAT', taxType: 'percentage', taxValue: 10, status: 1 });
  });
});
