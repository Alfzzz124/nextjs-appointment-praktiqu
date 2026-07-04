import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { IMPORT_ENTITIES, type ImportEntity } from '@/services/billing/import/validation';
import { importTemplates } from '@/services/billing/import/templates';

export const GET = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'import_manage');
  const entityParam = new URL(req.url).searchParams.get('entity');
  if (entityParam && !IMPORT_ENTITIES.includes(entityParam as ImportEntity)) {
    return kcFail(`Unknown entity: ${entityParam}`, 400);
  }
  return kcOk(importTemplates(entityParam ? (entityParam as ImportEntity) : undefined), 'Import templates retrieved successfully');
}));
