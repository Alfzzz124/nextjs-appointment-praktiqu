'use client';
/**
 * Preview pane component.
 *
 * Renders an already-rendered `RenderedTemplate` (from the preview API or
 * from the editor's local preview) in a read-only, side-by-side HTML/text
 * view. Used by both the editor page (T004) and the settings page.
 *
 * Source: specs/018-email-templates/spec.md, tasks.md
 */

import type { RenderedTemplate } from '@/types/email-template';

interface PreviewPaneProps {
  rendered: RenderedTemplate;
  /** Optional label to show instead of "Preview". */
  label?: string;
}

export function PreviewPane({ rendered, label = 'Rendered preview' }: PreviewPaneProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 bg-gray-50 px-4 py-2">
        <h3 className="text-sm font-semibold text-gray-700">{label}</h3>
      </div>
      <div className="space-y-3 p-4">
        {/* Subject */}
        <div>
          <div className="mb-1 text-xs font-medium text-gray-500">Subject</div>
          <div className="rounded bg-gray-50 px-3 py-2 font-medium text-gray-900">
            {rendered.subject || <span className="text-gray-400 italic">—</span>}
          </div>
        </div>

        {/* From name / Reply-To */}
        {(rendered.fromName || rendered.replyTo) && (
          <div className="grid grid-cols-2 gap-3">
            {rendered.fromName && (
              <div>
                <div className="mb-1 text-xs font-medium text-gray-500">From</div>
                <div className="rounded bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  {rendered.fromName}
                </div>
              </div>
            )}
            {rendered.replyTo && (
              <div>
                <div className="mb-1 text-xs font-medium text-gray-500">Reply-To</div>
                <div className="rounded bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  {rendered.replyTo}
                </div>
              </div>
            )}
          </div>
        )}

        {/* HTML body */}
        {rendered.bodyHtml && (
          <div>
            <div className="mb-1 text-xs font-medium text-gray-500">Body — HTML</div>
            <div
              className="rounded border border-gray-100 bg-white p-3"
              dangerouslySetInnerHTML={{ __html: rendered.bodyHtml }}
            />
          </div>
        )}

        {/* Plain-text body */}
        {rendered.bodyText && (
          <div>
            <div className="mb-1 text-xs font-medium text-gray-500">Body — Plain Text</div>
            <pre className="whitespace-pre-wrap rounded border border-gray-100 bg-gray-50 p-3 text-xs font-mono text-gray-700">
              {rendered.bodyText}
            </pre>
          </div>
        )}

        {/* Missing variables warning */}
        {rendered.missingVariables.length > 0 && (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-xs font-medium text-amber-800">
              Missing values for:{' '}
              <span className="font-mono">{rendered.missingVariables.join(', ')}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}