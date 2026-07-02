function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface EncounterView {
  id: number;
  encounter_date: unknown;
  patient_name: string | null;
  doctor_name: string | null;
  clinic_name: string | null;
  status: number;
  description: string | null;
}

export function renderEncounterHtml(e: EncounterView): string {
  const statusLabel = e.status === 0 ? 'Closed' : 'Open';
  const date = e.encounter_date ? String(e.encounter_date).slice(0, 10) : '-';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Encounter #${esc(e.id)}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 40px; color: #222; }
  h1 { font-size: 20px; } .row { margin: 8px 0; } .label { font-weight: bold; width: 140px; display: inline-block; }
  .notes { margin-top: 16px; white-space: pre-wrap; border-top: 1px solid #ccc; padding-top: 12px; }
</style></head>
<body>
  <h1>Encounter #${esc(e.id)}</h1>
  <div class="row"><span class="label">Date</span> ${esc(date)}</div>
  <div class="row"><span class="label">Patient</span> ${esc(e.patient_name)}</div>
  <div class="row"><span class="label">Doctor</span> ${esc(e.doctor_name)}</div>
  <div class="row"><span class="label">Clinic</span> ${esc(e.clinic_name)}</div>
  <div class="row"><span class="label">Status</span> ${esc(statusLabel)}</div>
  <div class="notes"><strong>Clinical notes</strong><br>${esc(e.description) || '<em>None</em>'}</div>
</body></html>`;
}
