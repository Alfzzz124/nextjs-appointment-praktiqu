/**
 * Duration options — one service offered at several lengths, each with its own price.
 *
 * Each option is its own catalogue row + mapping, because an appointment records only the
 * catalogue id: 60′ and 90′ must differ there. The option is tied to its parent by the
 * marker in `extra` (repositories/wp/duration-option-marker.ts).
 *
 * Pure: these rules decide; service.ts reads and writes.
 * Spec: docs/superpowers/specs/2026-11-05-opsi-durasi-layanan-design.md
 */

/** Extra durations beside the service's own — five lengths in all. */
export const MAX_DURATION_OPTIONS = 4;

const NAME_MAX = 255;

/**
 * `Konseling Individu (90 menit)`. The name lands in emails, invoices, Google Calendar and
 * WP admin, so it always states the length. Over 255 characters the parent's part is cut,
 * never the suffix.
 */
export function optionName(parentName: string, minutes: number): string {
  const suffix = ` (${minutes} menit)`;
  const room = NAME_MAX - suffix.length;
  const base = parentName.length > room ? parentName.slice(0, room).trimEnd() : parentName;
  return `${base}${suffix}`;
}

export type ExistingOption = {
  mappingId: bigint;
  serviceId: bigint;
  durationMinutes: number | null;
  charges: string | null;
};

/** One wanted option. `id` names an existing option's mapping; absent means a new one. */
export type WantedOption = { id?: number; duration: number; charges: string };

export type OptionPlan = {
  create: Array<{ duration: number; charges: string }>;
  keep: Array<{ existing: ExistingOption; duration: number; charges: string }>;
  remove: ExistingOption[];
};

export type OptionPlanError = {
  code: 'duration_option_limit' | 'duration_option_duplicate' | 'duration_option_not_found';
  message: string;
};

/**
 * Diff the wanted list against what exists. The wanted list is complete: an existing
 * option it does not mention is removed.
 */
export function planDurationOptions(
  existing: ExistingOption[],
  wanted: WantedOption[],
  parentDuration: number | null,
): { plan: OptionPlan } | { error: OptionPlanError } {
  if (wanted.length > MAX_DURATION_OPTIONS) {
    return {
      error: {
        code: 'duration_option_limit',
        message: `A service can have at most ${MAX_DURATION_OPTIONS} extra durations`,
      },
    };
  }

  const byId = new Map(existing.map((o) => [o.mappingId.toString(), o]));
  const seen = new Set<string>();
  for (const w of wanted) {
    if (w.id === undefined) continue;
    const key = String(w.id);
    if (!byId.has(key)) {
      return {
        error: { code: 'duration_option_not_found', message: `Duration option ${w.id} does not belong to this service` },
      };
    }
    if (seen.has(key)) {
      return { error: { code: 'duration_option_duplicate', message: `Duration option ${w.id} is listed twice` } };
    }
    seen.add(key);
  }

  const durations = wanted.map((w) => w.duration);
  if (parentDuration !== null) durations.push(parentDuration);
  if (new Set(durations).size !== durations.length) {
    return {
      error: {
        code: 'duration_option_duplicate',
        message: "Each duration may appear only once, the service's own duration included",
      },
    };
  }

  return {
    plan: {
      create: wanted.filter((w) => w.id === undefined).map((w) => ({ duration: w.duration, charges: w.charges })),
      keep: wanted
        .filter((w) => w.id !== undefined)
        .map((w) => ({ existing: byId.get(String(w.id))!, duration: w.duration, charges: w.charges })),
      remove: existing.filter((o) => !seen.has(o.mappingId.toString())),
    },
  };
}
