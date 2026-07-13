/**
 * Regression guard for the 2026-07 auth migration.
 *
 * 1) Behavioral: representative routes that were previously header-spoofable or
 *    ungated must now reject an unauthenticated request (401/403), never 200/500.
 * 2) Static: no route file (outside /public/ and /webhooks/) may reintroduce
 *    header-based auth (`x-user-id` / `x-praktiqu-user-*`) or a local `getActor`.
 */

import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { GET as sessionsGet } from '@/app/api/v1/sessions/route';
import { GET as customFieldsGet } from '@/app/api/v1/custom-fields/route';
import { GET as consentSignaturesGet } from '@/app/api/v1/consent-signatures/route';
import { GET as practicesGet } from '@/app/api/v1/practices/route';
import { GET as emailTemplatesGet } from '@/app/api/v1/email-templates/route';
import { GET as interventionPlansGet } from '@/app/api/v1/intervention-plans/route';
import { GET as sessionNotesGet } from '@/app/api/v1/session-notes/route';

const noAuthReq = (url: string) => new NextRequest(url);

describe('auth guard — unauthenticated requests are rejected', () => {
  const cases: Array<[string, (req: NextRequest) => Promise<Response>, string]> = [
    ['sessions', sessionsGet as never, 'http://localhost/api/v1/sessions'],
    ['custom-fields', customFieldsGet as never, 'http://localhost/api/v1/custom-fields'],
    ['consent-signatures', consentSignaturesGet as never, 'http://localhost/api/v1/consent-signatures'],
    ['practices', practicesGet as never, 'http://localhost/api/v1/practices'],
    ['email-templates', emailTemplatesGet as never, 'http://localhost/api/v1/email-templates'],
    ['intervention-plans', interventionPlansGet as never, 'http://localhost/api/v1/intervention-plans'],
    ['session-notes', sessionNotesGet as never, 'http://localhost/api/v1/session-notes'],
  ];

  it.each(cases)('%s GET without a token → 401/403', async (_name, handler, url) => {
    const res = await handler(noAuthReq(url));
    expect([401, 403]).toContain(res.status);
  });
});

describe('auth guard — static source check', () => {
  const API_ROOT = join(process.cwd(), 'src/app/api/v1');

  function routeFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) out.push(...routeFiles(p));
      else if (entry === 'route.ts') out.push(p);
    }
    return out;
  }

  const files = routeFiles(API_ROOT).filter(
    (p) => !p.includes(`${join('api', 'v1', 'public')}`) && !p.includes(`${join('api', 'v1', 'webhooks')}`),
  );

  it('no route reads spoofable identity headers', () => {
    const offenders = files.filter((p) => {
      const src = readFileSync(p, 'utf8');
      return /x-user-id|x-user-role|x-practice-id|x-praktiqu-user/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it('no route defines a local getActor placeholder', () => {
    const offenders = files.filter((p) => /function getActor\s*\(/.test(readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
