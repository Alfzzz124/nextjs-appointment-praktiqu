/**
 * `/public/professionals/by-slug/{slug}` must never be answered by the `[id]` routes.
 *
 * Route handlers are imported directly everywhere else, which says nothing about which
 * one Next would pick for a URL. This rebuilds the app's API route table from the file
 * system and resolves paths the way Next 14's DefaultRouteMatcherManager does: static
 * routes by exact match first, then dynamic ones in `getSortedRoutes` order, which puts
 * a static segment ahead of a dynamic one at the same depth. `getSortedRoutes` also
 * throws on two differently named dynamic segments at one level, so an `[id]` / `[slug]`
 * clash under `professionals/` would fail here rather than at `next build`.
 */
import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getSortedRoutes } from 'next/dist/shared/lib/router/utils/sorted-routes';
import { getRouteRegex } from 'next/dist/shared/lib/router/utils/route-regex';

const APP_DIR = resolve(__dirname, '../../../src/app');

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === 'route.ts' ? [path] : [];
  });
}

/** `src/app/api/v1/x/[id]/route.ts` → `/api/v1/x/[id]`, dropping `(group)` segments. */
function toRoute(file: string): string {
  const segments = relative(APP_DIR, file)
    .split(sep)
    .slice(0, -1)
    .filter((s) => !(s.startsWith('(') && s.endsWith(')')));
  return `/${segments.join('/')}`;
}

const routes = routeFiles(join(APP_DIR, 'api')).map(toRoute);
const staticRoutes = new Set(routes.filter((r) => !r.includes('[')));
const dynamicRoutes = getSortedRoutes(routes.filter((r) => r.includes('[')));

function resolveRoute(pathname: string): string | null {
  if (staticRoutes.has(pathname)) return pathname;
  return dynamicRoutes.find((r) => getRouteRegex(r).re.test(pathname)) ?? null;
}

describe('public professional route matching', () => {
  it('sends a slug lookup to by-slug, not to an [id] route', () => {
    expect(resolveRoute('/api/v1/public/professionals/by-slug/dianda-azani-m-psi-psikolog')).toBe(
      '/api/v1/public/professionals/by-slug/[slug]',
    );
    // A slug that happens to be a sibling route's name is still a slug.
    expect(resolveRoute('/api/v1/public/professionals/by-slug/services')).toBe(
      '/api/v1/public/professionals/by-slug/[slug]',
    );
  });

  it('still sends ids to the [id] routes', () => {
    expect(resolveRoute('/api/v1/public/professionals/8830100')).toBe(
      '/api/v1/public/professionals/[id]',
    );
    expect(resolveRoute('/api/v1/public/professionals/8830100/services')).toBe(
      '/api/v1/public/professionals/[id]/services',
    );
  });

  it('leaves the directory itself on its static route', () => {
    expect(resolveRoute('/api/v1/public/professionals')).toBe('/api/v1/public/professionals');
  });
});
