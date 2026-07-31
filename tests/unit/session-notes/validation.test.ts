/**
 * Session Notes validation.
 *
 * SOAP is gone (phase E3): a note is a KiviCare encounter now, and its body is typed
 * `entries` — problem / observation / note — which KiviCare's own views render.
 */

import { describe, it, expect } from 'vitest';
import {
  createSessionNoteSchema,
  updateSessionNoteSchema,
  listSessionNotesQuerySchema,
  entriesToContent,
  buildSummary,
} from '@/services/session-notes/validation';

describe('createSessionNoteSchema', () => {
  it('accepts valid content string', () => {
    const result = createSessionNoteSchema.safeParse({
      sessionId: '5150',
      content: 'Patient showed improvement in anxiety levels.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts typed entries instead of SOAP', () => {
    const result = createSessionNoteSchema.safeParse({
      sessionId: '5150',
      entries: [
        { type: 'problem', title: 'Kecemasan sosial' },
        { type: 'observation', title: 'Kontak mata membaik' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an entry type KiviCare does not know', () => {
    const result = createSessionNoteSchema.safeParse({
      sessionId: '5150',
      entries: [{ type: 'subjective', title: 'Sore throat' }],
    });
    expect(result.success).toBe(false);
  });

  it('requires either content or an entry', () => {
    expect(createSessionNoteSchema.safeParse({ sessionId: '5150' }).success).toBe(false);
    expect(createSessionNoteSchema.safeParse({ sessionId: '5150', entries: [] }).success).toBe(false);
  });

  it('rejects missing sessionId', () => {
    const result = createSessionNoteSchema.safeParse({ content: 'test' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric sessionId', () => {
    // The column still holds text, but the value is now wp_kc_appointments.id — a
    // leftover cuid would otherwise reach findSessionById as NaN.
    const result = createSessionNoteSchema.safeParse({
      sessionId: 'ses_abc123',
      content: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty content', () => {
    const result = createSessionNoteSchema.safeParse({ sessionId: '5150', content: '' });
    expect(result.success).toBe(false);
  });

  it('rejects content exceeding 50 000 chars', () => {
    const result = createSessionNoteSchema.safeParse({
      sessionId: '5150',
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

  it('accepts entries', () => {
    const result = updateSessionNoteSchema.safeParse({
      entries: [{ type: 'note', title: 'Ringkasan sesi' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty content, which clears the encounter description', () => {
    // Unlike create, an update to '' is meaningful: it blanks the summary text while
    // leaving the typed entries in place.
    expect(updateSessionNoteSchema.safeParse({ content: '' }).success).toBe(true);
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
      clientId: '461',
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

  it('rejects a non-numeric clientId', () => {
    expect(listSessionNotesQuerySchema.safeParse({ clientId: 'clt_xyz' }).success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = listSessionNotesQuerySchema.safeParse({ status: 'INVALID' });
    expect(result.success).toBe(false);
  });
});

describe('entriesToContent', () => {
  it('flattens the description and entries into one searchable body', () => {
    const out = entriesToContent('Sesi berjalan lancar', [
      { type: 'problem', title: 'Kecemasan sosial' },
      { type: 'note', title: 'Klien lebih terbuka' },
    ]);
    expect(out).toContain('Sesi berjalan lancar');
    expect(out).toContain('PROBLEM: Kecemasan sosial');
    expect(out).toContain('NOTE: Klien lebih terbuka');
  });

  it('omits an absent description rather than leaving a blank line', () => {
    const out = entriesToContent(null, [{ type: 'note', title: 'Hanya catatan' }]);
    expect(out).toBe('NOTE: Hanya catatan');
  });

  it('returns an empty string when there is nothing recorded', () => {
    expect(entriesToContent(null, [])).toBe('');
    expect(entriesToContent('   ', [])).toBe('');
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