/**
 * KiviCare's per-service category snapshot (`wp_kc_services.category`).
 *
 * Pure, so callers that mock the services repository still get the real parser.
 */
export type ServiceCategory = { id: number; label: string | null; value: string | null };

/**
 * KiviCare stores the category as a JSON snapshot rather than a foreign key, so the
 * label survives the static-data row being deleted. A snapshot written by hand, or by an
 * older KiviCare, may not parse — treat that as "no category" rather than a 500.
 */
export function parseServiceCategory(raw: string | null): ServiceCategory | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceCategory>;
    if (typeof parsed?.id !== 'number') return null;
    return { id: parsed.id, label: parsed.label ?? null, value: parsed.value ?? null };
  } catch {
    return null;
  }
}
