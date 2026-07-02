import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { CustomFieldService } from '@/services/custom-fields/service';
import { withAuth } from '@/lib/auth';

const prisma = new PrismaClient();
const service = new CustomFieldService(prisma);

export const POST = withAuth(async (req, _ctx) => {
  try {
    const body = await req.json();
    const { entityType, entityId, fieldId, value } = body;
    if (!entityType || !entityId || !fieldId) {
      return NextResponse.json({ type: 'about:blank', title: 'Bad Request', status: 400 }, { status: 400 });
    }
    await service.saveCustomFieldData(entityType, entityId, fieldId, value);
    return NextResponse.json({ message: 'Saved' });
  } catch {
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
});
