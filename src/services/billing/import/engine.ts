import { randomUUID } from 'crypto';
import Papa from 'papaparse';
import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';
import { rowSchemas, type ImportEntity } from './validation';
import { adapters, type ConflictStrategy } from './adapters';

export interface ImportResult {
  jobId: string; entity: ImportEntity; total: number;
  imported: number; updated: number; skipped: number; failed: number;
  errors: Array<{ row: number; message: string }>; dryRun: boolean;
}

/** Parse a CSV string into row objects (header row required). */
export function parseCsv(csv: string): Record<string, unknown>[] {
  const res = Papa.parse<Record<string, unknown>>(csv, { header: true, skipEmptyLines: true, dynamicTyping: false });
  if (res.errors.length) throw new KcError(`CSV parse error: ${res.errors[0].message} (row ${res.errors[0].row})`, 400);
  return res.data;
}

export async function runImport(
  entity: ImportEntity,
  rawRows: Record<string, unknown>[],
  opts: { conflictStrategy: ConflictStrategy; dryRun: boolean },
  kc: KcActor,
): Promise<ImportResult> {
  const adapter = adapters[entity];
  if (!adapter) throw new KcError(`Unsupported entity: ${entity}`, 400);
  const schema = rowSchemas[entity];
  const result: ImportResult = { jobId: randomUUID(), entity, total: rawRows.length, imported: 0, updated: 0, skipped: 0, failed: 0, errors: [], dryRun: opts.dryRun };

  for (let i = 0; i < rawRows.length; i++) {
    const rowNo = i + 1;
    const parsed = schema.safeParse(rawRows[i]);
    if (!parsed.success) { result.failed++; result.errors.push({ row: rowNo, message: parsed.error.issues[0]?.message ?? 'Invalid row' }); continue; }
    const row = parsed.data as any;
    try {
      const existingId = await adapter.findExisting(row, kc);
      if (existingId !== null) {
        if (opts.conflictStrategy === 'error') { result.failed++; result.errors.push({ row: rowNo, message: 'Conflict: a matching record already exists' }); continue; }
        if (opts.conflictStrategy === 'skip' || !adapter.update) { result.skipped++; continue; }
        if (!opts.dryRun) await adapter.update(existingId, row, kc);
        result.updated++; continue;
      }
      if (!opts.dryRun) await adapter.insert(row, kc);
      result.imported++;
    } catch (err) {
      result.failed++;
      result.errors.push({ row: rowNo, message: err instanceof KcError ? err.message : 'Insert failed' });
    }
  }
  return result;
}
