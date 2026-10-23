/**
 * Raw rows from WordPress's `wp_options`.
 *
 * Values come back exactly as stored — PHP-serialized for arrays, plain for strings —
 * because only the caller knows the shape it expects. A missing option is simply absent
 * from the map, never an empty string, so "not set" and "set to nothing" stay apart.
 *
 * Reads only. Options are written by WordPress and its plugins.
 */
import { prisma } from '@/lib/db';

export async function getWpOptions(names: string[]): Promise<Map<string, string>> {
  if (names.length === 0) return new Map();
  const rows = await prisma.kcOption.findMany({
    where: { optionName: { in: names } },
    select: { optionName: true, optionValue: true },
  });
  return new Map(rows.map((r) => [r.optionName, r.optionValue]));
}
