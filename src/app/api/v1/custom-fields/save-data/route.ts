import { NextResponse } from 'next/server';
import { CustomFieldError, CustomFieldService } from '@/services/custom-fields/service';
import { withAuth } from '@/lib/auth';
import { assertEntityAccess, entityAccessProblem } from '@/services/custom-fields/access';
import { MODULE_TYPES, type ModuleType } from '@/services/custom-fields/service';

const service = new CustomFieldService();

export const POST = withAuth(async (req, ctx) => {
  try {
    const body = await req.json();
    const { entityType, entityId, fieldId, value } = body;

    // Staff only, and only for an entity this actor may open. The type and id are checked
    // here as well as by setValue's schema so the guard never sees a malformed pair; a bad
    // pair falls through to setValue, whose ZodError is the 400.
    const entityNumber = Number(entityId);
    if (
      (MODULE_TYPES as readonly string[]).includes(entityType) &&
      Number.isSafeInteger(entityNumber) &&
      entityNumber > 0
    ) {
      await assertEntityAccess(ctx.actor, entityType as ModuleType, entityNumber, 'write');
    }

    // setValue's schema does the real work: it validates the module type, coerces the
    // two ids to positive integers, and then checks the value against the field's own
    // definition. A bad payload throws a ZodError, which is a 400 below — the old code
    // reported it as a 500.
    const saved = await service.setValue({
      moduleType: entityType,
      moduleId: entityId,
      fieldId,
      fieldValue: value,
    });

    return NextResponse.json({ message: 'Saved', data: saved });
  } catch (err) {
    const denied = entityAccessProblem(err);
    if (denied) return denied;
    if (err instanceof CustomFieldError) {
      return NextResponse.json(
        { type: 'about:blank', title: err.message, status: err.status, code: err.code },
        { status: err.status },
      );
    }
    if ((err as { name?: string })?.name === 'ZodError') {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Validation failed',
          status: 400,
          errors: (err as { errors?: unknown }).errors,
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
});
