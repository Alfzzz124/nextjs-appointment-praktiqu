/**
 * Time utilities for client components.
 * Mirrors server-side lib/time.ts but safe for client-side use.
 */

/**
 * Convert minutes from midnight to HH:mm string.
 * @example minutesToTime(570) => '09:30'
 */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/**
 * Convert HH:mm string to minutes from midnight.
 * @example timeToMinutes('09:30') => 570
 */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}