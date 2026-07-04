import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { importRequestSchema, IMPORT_ENTITIES, type ImportEntity } from '@/services/billing/import/validation';
import { runImport, parseCsv } from '@/services/billing/import/engine';
import type { ConflictStrategy } from '@/services/billing/import/adapters';

const MAX_ROWS = 10_000;

// Dry-run counterpart of POST /import: parse + validate + conflict-check, no writes.
export const POST = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'import_manage');

  const ct = req.headers.get('content-type') ?? '';
  let entity: string;
  let conflictStrategy: string = 'error';
  let rows: Record<string, unknown>[];

  if (ct.includes('multipart/form-data')) {
    const form = await req.formData();
    entity = String(form.get('entity') ?? '');
    conflictStrategy = String(form.get('conflictStrategy') ?? 'error');
    const file = form.get('file');
    if (!(file instanceof File)) return kcFail('file is required for multipart import', 400);
    rows = parseCsv(await file.text());
  } else {
    const parsed = importRequestSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail('Invalid input', 400);
    entity = parsed.data.entity;
    conflictStrategy = parsed.data.conflictStrategy;
    rows = parsed.data.rows ?? [];
  }

  if (!IMPORT_ENTITIES.includes(entity as ImportEntity)) return kcFail(`Unknown entity: ${entity}`, 400);
  if (!['error', 'skip', 'update'].includes(conflictStrategy)) return kcFail(`Unknown conflictStrategy: ${conflictStrategy}`, 400);
  if (rows.length === 0) return kcFail('No rows to validate', 400);
  if (rows.length > MAX_ROWS) return kcFail(`Too many rows: ${rows.length} (max ${MAX_ROWS})`, 400);

  const kc = await resolveKcActor(actor);
  const out = await runImport(entity as ImportEntity, rows, { conflictStrategy: conflictStrategy as ConflictStrategy, dryRun: true }, kc);
  return kcOk(out, `Dry-run: would import ${out.imported}, update ${out.updated}, skip ${out.skipped}, fail ${out.failed}`);
}));
