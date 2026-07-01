import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { CustomFieldService } from '@/services/custom-fields/service';
import { withAuth } from '@/lib/auth';

const prisma = new PrismaClient();
const service = new CustomFieldService(prisma);

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const entityType = searchParams.get('entityType');
    const entityId = searchParams.get('entityId');
    if (!entityType || !entityId) {
      return NextResponse.json({ type: 'about:blank', title: 'Bad Request', status: 400 }, { status: 400 });
    }
    const items = await service.getCustomFieldData(entityType, entityId);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
});
