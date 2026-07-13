/**
 * Email template rendering engine.
 *
 * Source of truth: specs/018-email-templates/plan.md
 * Storage:       prisma EmailTemplate model
 *
 * Responsibilities:
 *   1. Substitute `{{varName}}` placeholders in subject + body with values
 *      from a `VariableContext`.
 *   2. Track which declared variables were not supplied (so the UI can
 *      warn the editor before sending).
 *   3. Provide a best-effort HTML-to-text fallback when only HTML is
 *      provided (used by the editor preview).
 *
 * Design choices:
 *   - Strict placeholder matching (`{{ name }}` with whitespace tolerance).
 *   - Unknown / missing variables are left as `{{ name }}` so the sender
 *     (notifications worker) can surface them as a runtime error if it
 *     requires all declared variables.
 *   - HTML stripping is intentionally simple — we don't pull in a full
 *     sanitizer here. The aim is "good enough for a preview pane."
 */

import {
  PLACEHOLDER_RE,
  type RenderedTemplate,
  type VariableContext,
} from '@/types/email-template';

/**
 * Render a single string by substituting `{{varName}}` tokens.
 * Returns the rendered string and a sorted list of placeholder names that
 * could not be resolved.
 */
export function renderString(
  template: string,
  variables: VariableContext = {},
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = template.replace(PLACEHOLDER_RE, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, name)) {
      const value = variables[name];
      if (value === null || value === undefined) {
        missing.add(name);
        return match; // preserve placeholder
      }
      return String(value);
    }
    missing.add(name);
    return match;
  });
  return { text, missing: Array.from(missing).sort() };
}

/**
 * Extract the set of placeholder names declared inside a template string.
 * Used to auto-detect variables in the editor.
 */
export function extractPlaceholders(template: string): string[] {
  const found = new Set<string>();
  // Use a fresh regex to avoid the global `lastIndex` state.
  const re = new RegExp(PLACEHOLDER_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    found.add(m[1]);
  }
  return Array.from(found).sort();
}

/**
 * Render a full email template (subject + html + text) with the given
 * variable context.
 *
 * If `subjectOverride` / `bodyHtmlOverride` / `bodyTextOverride` are
 * supplied (preview use case), they take precedence over the stored
 * values from the EmailTemplate row.
 */
export function renderTemplate(
  stored: {
    subject: string;
    bodyHtml: string;
    bodyText: string;
    fromName?: string | null;
    replyTo?: string | null;
  },
  variables: VariableContext,
  overrides?: {
    subject?: string;
    bodyHtml?: string;
    bodyText?: string;
    fromName?: string | null;
    replyTo?: string | null;
  },
): RenderedTemplate {
  const subjectSrc = overrides?.subject ?? stored.subject;
  const htmlSrc = overrides?.bodyHtml ?? stored.bodyHtml;
  const textSrc = overrides?.bodyText ?? stored.bodyText;
  const fromName = overrides?.fromName !== undefined ? overrides.fromName : stored.fromName ?? null;
  const replyTo = overrides?.replyTo !== undefined ? overrides.replyTo : stored.replyTo ?? null;

  const subject = renderString(subjectSrc, variables);
  const html = renderString(htmlSrc, variables);
  const text = renderString(textSrc, variables);

  // Union of all missing variable names across the three fields.
  const missing = Array.from(
    new Set([...subject.missing, ...html.missing, ...text.missing]),
  ).sort();

  return {
    subject: subject.text,
    bodyHtml: html.text,
    bodyText: text.text,
    fromName: fromName ?? null,
    replyTo: replyTo ?? null,
    missingVariables: missing,
  };
}

/**
 * Best-effort HTML to plain-text conversion for the editor preview.
 *
 * - Strips script/style content.
 * - Adds a newline after block-level closing tags.
 * - Decodes common HTML entities.
 *
 * This is NOT a general-purpose HTML sanitizer; the renderer does not
 * trust the input. It exists only so the preview pane can show a
 * readable text version when the user has not supplied one.
 */
export function htmlToText(html: string): string {
  let out = html;
  // Remove script/style blocks entirely.
  out = out.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<style\b[\s\S]*?<\/style>/gi, '');
  // Convert <br> and block closers to newlines. Block closers get a blank
  // line so paragraphs are visually separated.
  out = out.replace(/<br\s*\/?>(?!\n)/gi, '\n');
  out = out.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n\n');
  // Strip remaining tags.
  out = out.replace(/<[^>]+>/g, '');
  // Collapse excessive blank lines (2+ consecutive newlines → 2).
  out = out.replace(/[\r\n]{3,}/g, '\n\n');
  // Collapse multiple consecutive spaces → 2 (preserve intentional double spaces).
  out = out.replace(/ {3,}/g, '  ').trim();
  // Decode a small set of entities AFTER trimming so entity-produced whitespace
  // (e.g. a trailing &nbsp;) is preserved rather than stripped.
  out = out
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return out;
}
