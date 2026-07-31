import { NextResponse } from 'next/server';
import { CustomFieldError, CustomFieldService } from '@/services/custom-fields/service';
import { withAuth } from '@/lib/auth';

const service = new CustomFieldService();

export const POST = withAuth(async (req, _ctx) => {
  try {
    const body = await req.json();
    const { entityType, entityId, fieldId, value } = body;

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
