import { prisma } from '@/lib/db';

const TEST_MARKER = 9_000_000; // ids in this range belong to tests

export function assertTestDb(): void {
  const url = process.env.DATABASE_URL ?? '';
  if (!/test/i.test(url)) {
    throw new Error('Refusing to seed fixtures: DATABASE_URL does not look like a test DB');
  }
}

export async function seedClinicAdmin(opts: { userId: number; clinicId: number }) {
  assertTestDb();
  await prisma.kcUser.create({
    data: {
      id: BigInt(opts.userId), userLogin: `admin${opts.userId}`,
      userEmail: `admin${opts.userId}@test.local`, displayName: 'Admin',
      userRegistered: new Date(),
    },
  });
  await prisma.kcClinic.create({
    data: { id: BigInt(opts.clinicId), name: 'Test Clinic', clinicAdminId: BigInt(opts.userId), clinicLogo: 0n, status: 1, createdAt: new Date() } as any,
  });
  // Link the PraktiQU user (cuid) → wpUserId for resolveKcActor.
  await prisma.user.create({
    data: {
      id: `test-admin-${opts.userId}`, email: `admin${opts.userId}@test.local`,
      username: `admin${opts.userId}`, firstName: 'A', lastName: 'D',
      displayName: 'Admin', role: 'CLINIC_ADMIN', wpUserId: BigInt(opts.userId), status: 1,
    },
  });
}

export async function seedTax(data: Partial<{ id: number; name: string; taxType: string; taxValue: string; clinicId: number; status: number }>) {
  assertTestDb();
  return prisma.kcTax.create({
    data: {
      id: BigInt(data.id ?? TEST_MARKER + 1),
      name: data.name ?? 'VAT', taxType: data.taxType ?? 'percentage',
      taxValue: data.taxValue ?? '10', clinicId: BigInt(data.clinicId ?? -1),
      doctorId: -1n, serviceId: -1n, addedBy: 1n, status: data.status ?? 1, createdAt: new Date(),
    },
  });
}

export async function cleanup() {
  assertTestDb();
  await prisma.kcTax.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcBillItem.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcBill.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcTaxData.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcClinic.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'test-' } } });
}
