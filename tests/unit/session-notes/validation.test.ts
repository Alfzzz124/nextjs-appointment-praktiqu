/**
 * Unit tests for the Session Notes validation module.
 * Tests the Zod schemas, SOAP formatting, and summary builder.
 */

import { describe, it, expect } from 'vitest';
import {
  createSessionNoteSchema,
  updateSessionNoteSchema,
  listSessionNotesQuerySchema,
  formatSoapToContent,
  buildSummary,
} from '@/services/session-notes/validation';

describe('createSessionNoteSchema', () => {
  it('accepts valid content string', () => {
    const result = createSessionNoteSchema.safeParse({
      sessionId: 'ses_abc123',
      content: 'Patient showed improvement in anxiety levels.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid SOAP input', () => {
    const result = createSessionNoteSchema.safeParse({
      sessionId: 'ses_abc123',
      soap: { subjective: 'Sore throat', objective: 'T=37.8', assessment: 'Viral', plan: 'Rest' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing sessionId', () => {
    const result = createSessionNoteSchema.safeParse({ content: 'test' });
    expect(result.success).toBe(false);
  });

  it('rejects empty content', () => {
    const result = createSessionNoteSchema.safeParse({ sessionId: 'ses_abc123', content: '' });
    expect(result.success).toBe(false);
  });

  it('rejects content exceeding 50 000 chars', () => {
    const result = createSessionNoteSchema.safeParse({
      sessionId: 'ses_abc123',
      content: 'x'.repeat(50_001),
    });
    expect(result.success).toBe(false);
  });
});

describe('updateSessionNoteSchema', () => {
  it('accepts valid content', () => {
    const result = updateSessionNoteSchema.safeParse({ content: 'Updated note' });
    expect(result.success).toBe(true);
  });

  it('accepts SOAP input', () => {
    const result = updateSessionNoteSchema.safeParse({
      soap: { subjective: 'S', objective: 'O', assessment: 'A', plan: 'P' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty content', () => {
    const result = updateSessionNoteSchema.safeParse({ content: '' });
    expect(result.success).toBe(false);
  });
});

describe('listSessionNotesQuerySchema', () => {
  it('defaults page and limit', () => {
    const result = listSessionNotesQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('accepts all optional filters', () => {
    const result = listSessionNotesQuerySchema.safeParse({
      page: 3,
      limit: 50,
      search: 'anxiety',
      clientId: 'clt_xyz',
      dateFrom: '2026-01-01',
      dateTo: '2026-06-30',
      status: 'OPEN',
    });
    expect(result.success).toBe(true);
  });

  it('rejects limit over 100', () => {
    const result = listSessionNotesQuerySchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = listSessionNotesQuerySchema.safeParse({ status: 'INVALID' });
    expect(result.success).toBe(false);
  });
});

describe('formatSoapToContent', () => {
  it('formats SOAP sections with headers', () => {
    const result = formatSoapToContent({
      subjective: 'Client reports increased anxiety',
      objective: 'Observed tense posture',
      assessment: 'GAD worsening',
      plan: 'Increase session frequency to weekly',
    });
    expect(result).toContain('SUBJECTIVE:');
    expect(result).toContain('OBJECTIVE:');
    expect(result).toContain('ASSESSMENT:');
    expect(result).toContain('PLAN:');
  });

  it('trims empty sections', () => {
    const result = formatSoapToContent({
      subjective: 'Client reports increased anxiety',
      objective: '',
      assessment: '',
      plan: '',
    });
    expect(result).not.toMatch(/^OBJECTIVE:\s*$/m);
  });

  it('returns empty string when all sections empty', () => {
    const result = formatSoapToContent({ subjective: '', objective: '', assessment: '', plan: '' });
    expect(result).toBe('');
  });
});

describe('buildSummary', () => {
  it('returns full content when under limit', () => {
    const content = 'Short note.';
    expect(buildSummary(content)).toBe('Short note.');
  });

  it('truncates with ellipsis at max length', () => {
    const content = 'A'.repeat(250);
    const result = buildSummary(content, 200);
    expect(result.length).toBe(200);
    expect(result.endsWith('…')).toBe(true);
  });

  it('collapses whitespace in summary', () => {
    const content = 'Patient   reported\n\n  severe   headaches.';
    const result = buildSummary(content);
    expect(result).not.toContain('\n');
    expect(result).not.toMatch(/\s{2,}/);
  });

  it('handles exact boundary', () => {
    const content = 'A'.repeat(200);
    expect(buildSummary(content, 200)).toBe(content);
    expect(buildSummary(content, 200).length).toBe(200);
  });
});