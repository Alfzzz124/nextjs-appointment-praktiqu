/**
 * Unit tests: email template preview / rendering engine.
 *
 * Covers:
 *   - renderString: placeholder substitution
 *   - extractPlaceholders: auto-detecting variables from a template
 *   - renderTemplate: full template rendering
 *   - htmlToText: HTML → plain-text conversion for preview
 *
 * Run: npx vitest run tests/unit/email-templates/preview.test.ts
 *
 * Source: specs/018-email-templates/plan.md (T003)
 */

import { describe, expect, it } from 'vitest';
import {
  extractPlaceholders,
  htmlToText,
  renderString,
  renderTemplate,
} from '@/services/email-templates/preview.service';

describe('renderString', () => {
  it('substitutes a single placeholder', () => {
    const { text, missing } = renderString('Hello {{ name }}!', { name: 'Alice' });
    expect(text).toBe('Hello Alice!');
    expect(missing).toHaveLength(0);
  });

  it('substitutes multiple placeholders', () => {
    const { text, missing } = renderString(
      'Dear {{ client_name }}, your appointment is on {{ appointment_date }}.',
      { client_name: 'Bob', appointment_date: '2026-06-15' },
    );
    expect(text).toBe('Dear Bob, your appointment is on 2026-06-15.');
    expect(missing).toHaveLength(0);
  });

  it('leaves unmatched placeholders unchanged and reports them as missing', () => {
    const { text, missing } = renderString('Hello {{ name }} — your {{ missing_var }} is due.', {
      name: 'Carol',
    });
    expect(text).toBe('Hello Carol — your {{ missing_var }} is due.');
    expect(missing).toEqual(['missing_var']);
  });

  it('tolerates whitespace inside placeholders', () => {
    const { text, missing } = renderString('Hello {{  name  }}!', { name: 'Dave' });
    expect(text).toBe('Hello Dave!');
    expect(missing).toHaveLength(0);
  });

  it('treats null values as missing', () => {
    const { text, missing } = renderString('Hello {{ name }}', {
      name: null,
    });
    expect(text).toBe('Hello {{ name }}');
    expect(missing).toEqual(['name']);
  });

  it('treats undefined values as missing', () => {
    const { text, missing } = renderString('Hello {{ name }}', {});
    expect(text).toBe('Hello {{ name }}');
    expect(missing).toEqual(['name']);
  });

  it('stringifies numbers', () => {
    const { text } = renderString('Amount: {{ amount }}', { amount: 42 });
    expect(text).toBe('Amount: 42');
  });

  it('stringifies booleans', () => {
    const { text } = renderString('Confirmed: {{ confirmed }}', { confirmed: true });
    expect(text).toBe('Confirmed: true');
  });

  it('is case-sensitive', () => {
    const { text, missing } = renderString('{{ Name }} vs {{ name }}', { name: 'lowercase' });
    expect(text).toBe('{{ Name }} vs lowercase');
    expect(missing).toEqual(['Name']);
  });

  it('handles repeated placeholders', () => {
    const { text } = renderString('From {{ name }} to {{ name }}', { name: 'Eve' });
    expect(text).toBe('From Eve to Eve');
  });

  it('handles empty template', () => {
    const { text, missing } = renderString('', { name: 'Any' });
    expect(text).toBe('');
    expect(missing).toHaveLength(0);
  });

  it('handles template with no placeholders', () => {
    const { text, missing } = renderString('Static content only.', { name: 'Ignored' });
    expect(text).toBe('Static content only.');
    expect(missing).toHaveLength(0);
  });
});

describe('extractPlaceholders', () => {
  it('extracts a single variable name', () => {
    expect(extractPlaceholders('Hello {{ client_name }}!')).toEqual(['client_name']);
  });

  it('extracts multiple variable names in sorted order', () => {
    const result = extractPlaceholders(
      'From {{ sender }} to {{ recipient }} on {{ date }}',
    );
    expect(result).toEqual(['date', 'recipient', 'sender']);
  });

  it('de-duplicates repeated names', () => {
    const result = extractPlaceholders('{{ x }} + {{ x }} + {{ x }}');
    expect(result).toEqual(['x']);
  });

  it('ignores unknown tags', () => {
    const result = extractPlaceholders('Use {{ var }} and [not-a-var]');
    expect(result).toEqual(['var']);
  });

  it('returns empty array for no placeholders', () => {
    expect(extractPlaceholders('No placeholders here.')).toEqual([]);
  });

  it('tolerates whitespace inside braces', () => {
    expect(extractPlaceholders('{{  foo_bar  }}')).toEqual(['foo_bar']);
  });
});

describe('renderTemplate', () => {
  const baseTemplate = {
    subject: '{{ session_title }} Confirmation',
    bodyHtml: '<p>Hello {{ client_name }}, your session is on {{ session_date }}.</p>',
    bodyText: 'Hello {{ client_name }}, your session is on {{ session_date }}.',
    fromName: 'Clinic',
    replyTo: 'admin@clinic.example',
  };

  it('renders all fields from stored template', () => {
    const result = renderTemplate(
      baseTemplate,
      { session_title: 'Annual Checkup', client_name: 'Alice', session_date: '2026-06-15' },
    );
    expect(result.subject).toBe('Annual Checkup Confirmation');
    expect(result.bodyHtml).toBe(
      '<p>Hello Alice, your session is on 2026-06-15.</p>',
    );
    expect(result.bodyText).toBe('Hello Alice, your session is on 2026-06-15.');
    expect(result.fromName).toBe('Clinic');
    expect(result.replyTo).toBe('admin@clinic.example');
    expect(result.missingVariables).toHaveLength(0);
  });

  it('reports missing variables across all fields', () => {
    const result = renderTemplate(
      baseTemplate,
      { session_title: 'Checkup' }, // missing client_name and session_date
    );
    expect(result.missingVariables).toEqual(['client_name', 'session_date']);
  });

  it('overrides subject when provided', () => {
    const result = renderTemplate(
      baseTemplate,
      { session_title: 'Checkup', client_name: 'Bob', session_date: '2026-07-01' },
      { subject: 'Overridden Subject' },
    );
    expect(result.subject).toBe('Overridden Subject');
  });

  it('overrides bodyHtml when provided', () => {
    const result = renderTemplate(
      baseTemplate,
      { session_title: 'Checkup', client_name: 'Bob', session_date: '2026-07-01' },
      { bodyHtml: '<strong>Custom HTML</strong>' },
    );
    expect(result.bodyHtml).toBe('<strong>Custom HTML</strong>');
  });

  it('overrides bodyText when provided', () => {
    const result = renderTemplate(
      baseTemplate,
      { client_name: 'Carol' },
      { bodyText: 'Plain override.' },
    );
    expect(result.bodyText).toBe('Plain override.');
  });

  it('overrides fromName when provided', () => {
    const result = renderTemplate(
      baseTemplate,
      {},
      { fromName: 'New Sender' },
    );
    expect(result.fromName).toBe('New Sender');
  });

  it('uses stored fromName when override is undefined', () => {
    const result = renderTemplate(
      baseTemplate,
      {},
      {}, // no override
    );
    expect(result.fromName).toBe('Clinic');
  });

  it('allows null override for fromName', () => {
    const result = renderTemplate(baseTemplate, {}, { fromName: null });
    expect(result.fromName).toBeNull();
  });

  it('allows null override for replyTo', () => {
    const result = renderTemplate(baseTemplate, {}, { replyTo: null });
    expect(result.replyTo).toBeNull();
  });
});

describe('htmlToText', () => {
  it('strips simple tags', () => {
    expect(htmlToText('<p>Hello <strong>world</strong></p>')).toBe('Hello world');
  });

  it('converts <br> to newlines', () => {
    expect(htmlToText('Line 1<br>Line 2<br/>Line 3')).toBe('Line 1\nLine 2\nLine 3');
  });

  it('adds newlines after block-level closers', () => {
    expect(htmlToText('<p>Para 1</p><p>Para 2</p>')).toBe('Para 1\n\nPara 2');
  });

  it('removes script and style blocks entirely', () => {
    const input =
      '<script>alert("hi")</script><p>Text</p><style>.foo{}</style>';
    expect(htmlToText(input)).toBe('Text');
  });

  it('decodes common HTML entities', () => {
    expect(htmlToText('&amp; &lt; &gt; &quot; &#39; &nbsp;')).toBe(
      '& < > " \'  ',
    );
  });

  it('collapses excessive blank lines', () => {
    expect(htmlToText('<p>A</p><br><p>B</p>')).toBe('A\n\nB');
  });

  it('returns empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
  });
});