import { NextResponse } from 'next/server';
import {
  CustomFieldService,
  MODULE_TYPES,
  type ModuleType,
} from '@/services/custom-fields/service';
import { withAuth } from '@/lib/auth';
import { assertEntityAccess, entityAccessProblem } from '@/services/custom-fields/access';

const service = new CustomFieldService();

export const GET = withAuth(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get('entityType');
  const entityIdRaw = searchParams.get('entityId');

  if (!entityType || !entityIdRaw) {
    return NextResponse.json(
      { type: 'about:blank', title: 'entityType and entityId are required', status: 400 },
      { status: 400 },
    );
  }

  if (!(MODULE_TYPES as readonly string[]).includes(entityType)) {
    return NextResponse.json(
      {
        type: 'about:blank',
        title: `entityType must be one of: ${MODULE_TYPES.join(', ')}`,
        status: 400,
      },
      { status: 400 },
    );
  }

  // Entity ids are WordPress/KiviCare integers now — reject anything else rather than
  // reaching the database with NaN.
  const entityId = Number(entityIdRaw);
  if (!Number.isSafeInteger(entityId) || entityId <= 0) {
    return NextResponse.json(
      { type: 'about:blank', title: 'entityId must be a positive integer', status: 400 },
      { status: 400 },
    );
  }

  // Without this, any signed-in account could read the values of any client, appointment
  // or encounter.
  try {
    await assertEntityAccess(ctx.actor, entityType as ModuleType, entityId, 'read');
  } catch (err) {
    const problem = entityAccessProblem(err);
    if (problem) return problem;
    throw err;
  }

  const items = await service.getValues(entityType as ModuleType, entityId);
  return NextResponse.json({ items });
});
