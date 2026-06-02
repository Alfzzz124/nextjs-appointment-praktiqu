// tests/unit/intervention-plan-print/print.test.ts
import { describe, it, expect } from 'vitest';
import { buildHtml, groupRecommendationsByStatus, formatDate, InterventionPlanPrintService } from '@/services/intervention-plan-print/print';

const sample = {
  id: 'p1',
  clientName: 'Ada Lovelace',
  clientId: 'c1',
  professionalName: 'Dr. Hopper',
  clinicName: 'Test Clinic',
  title: 'Recovery plan',
  description: 'Plan to manage lower back pain.',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-04-01'),
  recommendations: [
    { id: 'r1', title: 'Stretch', description: '15 min', frequency: 'daily', completed: false, completedAt: null as Date | null },
    { id: 'r2', title: 'Walk', frequency: 'daily', completed: true, completedAt: new Date('2026-02-10') },
  ],
};

describe('groupRecommendationsByStatus', () => {
  it('partitions recommendations', () => {
    const { open, done } = groupRecommendationsByStatus(sample);
    expect(open.map((r) => r.id)).toEqual(['r1']);
    expect(done.map((r) => r.id)).toEqual(['r2']);
  });
});

describe('formatDate', () => {
  it('formats date', () => {
    expect(formatDate(new Date('2026-01-15'))).toMatch(/2026/);
  });
  it('returns em-dash for undefined', () => {
    expect(formatDate(undefined)).toBe('—');
  });
});

describe('buildHtml', () => {
  it('produces full HTML document', () => {
    const html = buildHtml(sample);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain(sample.title);
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('Stretch');
    expect(html).toContain('done');
  });
  it('escapes HTML', () => {
    const html = buildHtml({ ...sample, title: '<script>x</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('handles empty recommendations', () => {
    const html = buildHtml({ ...sample, recommendations: [] });
    expect(html).toContain('No recommendations');
  });
});

describe('InterventionPlanPrintService', () => {
  it('renders through service class', () => {
    const svc = new InterventionPlanPrintService();
    const out = svc.render(sample);
    expect(out).toContain(sample.title);
  });
});
