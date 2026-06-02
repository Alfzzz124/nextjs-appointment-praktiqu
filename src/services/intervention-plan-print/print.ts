// src/services/intervention-plan-print/print.ts
// Helpers for rendering an intervention plan for print/PDF.

export interface PrintablePlan {
  id: string;
  clientName: string;
  clientId: string;
  professionalName: string;
  clinicName?: string;
  title: string;
  description?: string;
  startDate: Date;
  endDate?: Date;
  recommendations: Array<{
    id: string;
    title: string;
    description?: string;
    frequency?: string;
    completed: boolean;
    completedAt?: Date | null;
  }>;
  notes?: string;
}

export function groupRecommendationsByStatus(plan: PrintablePlan) {
  const open = plan.recommendations.filter((r) => !r.completed);
  const done = plan.recommendations.filter((r) => r.completed);
  return { open, done };
}

export function formatDate(d: Date | string | undefined, locale = 'en-US'): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function buildHtml(plan: PrintablePlan, branding?: { logoUrl?: string; primaryColor?: string }): string {
  const { open, done } = groupRecommendationsByStatus(plan);
  const primary = branding?.primaryColor ?? '#0ea5e9';
  const logo = branding?.logoUrl ?? '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escape(plan.title)}</title>
<style>
  @page { size: A4; margin: 24mm 18mm; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #111; line-height: 1.5; }
  h1 { color: ${primary}; margin: 0 0 4px; font-size: 22pt; }
  h2 { color: ${primary}; margin-top: 24px; font-size: 14pt; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .meta { color: #555; font-size: 10pt; margin-bottom: 18px; }
  .recommendation { padding: 8px 0; border-bottom: 1px dashed #eee; }
  .recommendation.done { opacity: 0.6; text-decoration: line-through; }
  .freq { color: #666; font-size: 9pt; }
  .footer { margin-top: 32px; font-size: 9pt; color: #888; text-align: center; }
  .logo { max-height: 48px; }
</style>
</head>
<body>
  <header>
    ${logo ? `<img class="logo" src="${escape(logo)}" alt="logo" />` : ''}
    <h1>${escape(plan.title)}</h1>
    <div class="meta">
      <div><strong>Client:</strong> ${escape(plan.clientName)}</div>
      <div><strong>Professional:</strong> ${escape(plan.professionalName)}</div>
      ${plan.clinicName ? `<div><strong>Clinic:</strong> ${escape(plan.clinicName)}</div>` : ''}
      <div><strong>Period:</strong> ${formatDate(plan.startDate)} — ${plan.endDate ? formatDate(plan.endDate) : 'ongoing'}</div>
    </div>
  </header>

  ${plan.description ? `<section><h2>Overview</h2><p>${escape(plan.description)}</p></section>` : ''}

  <section>
    <h2>Recommendations (${open.length} open, ${done.length} done)</h2>
    ${open.length === 0 && done.length === 0 ? '<p><em>No recommendations.</em></p>' : ''}
    ${open.map(recBlock).join('')}
    ${done.map(recBlock).join('')}
  </section>

  ${plan.notes ? `<section><h2>Notes</h2><p>${escape(plan.notes)}</p></section>` : ''}

  <div class="footer">Generated ${formatDate(new Date())} — PraktiQU</div>
</body>
</html>`;
}

function recBlock(r: PrintablePlan['recommendations'][number]): string {
  return `<div class="recommendation ${r.completed ? 'done' : ''}">
    <strong>${escape(r.title)}</strong>
    ${r.description ? `<div>${escape(r.description)}</div>` : ''}
    ${r.frequency ? `<div class="freq">Frequency: ${escape(r.frequency)}</div>` : ''}
    ${r.completed && r.completedAt ? `<div class="freq">Completed ${formatDate(r.completedAt)}</div>` : ''}
  </div>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class InterventionPlanPrintService {
  render(plan: PrintablePlan, branding?: { logoUrl?: string; primaryColor?: string }): string {
    return buildHtml(plan, branding);
  }
}
