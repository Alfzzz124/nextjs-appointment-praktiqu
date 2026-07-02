import { prisma } from '@/lib/prisma';
import { ServiceStatus } from '@prisma/client';
import { SLOT_HOLD_TTL_MS } from '@/services/booking/slot-hold.service';

export interface PublicClinic {
  id: string; name: string; email: string | null; telephoneNo: string | null;
  address: string | null; city: string | null; state: string | null;
  country: string | null; postalCode: string | null; specialties: unknown;
}

function toPublicClinic(c: {
  id: string; name: string; email: string | null; telephoneNo: string | null;
  address: string | null; city: string | null; state: string | null;
  country: string | null; postalCode: string | null; specialties: unknown;
}): PublicClinic {
  return {
    id: c.id, name: c.name, email: c.email, telephoneNo: c.telephoneNo,
    address: c.address, city: c.city, state: c.state, country: c.country,
    postalCode: c.postalCode, specialties: c.specialties,
  };
}

export async function listPublicPractices(): Promise<PublicClinic[]> {
  const clinics = await prisma.clinic.findMany({
    where: { status: 1 },
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true, email: true, telephoneNo: true, address: true,
      city: true, state: true, country: true, postalCode: true, specialties: true,
    },
  });
  return clinics.map(toPublicClinic);
}

export async function getPublicPractice(id: string): Promise<PublicClinic | null> {
  const clinic = await prisma.clinic.findFirst({
    where: { id, status: 1 },
    select: {
      id: true, name: true, email: true, telephoneNo: true, address: true,
      city: true, state: true, country: true, postalCode: true, specialties: true,
    },
  });
  return clinic ? toPublicClinic(clinic) : null;
}

export interface PublicService {
  id: string; name: string; description: string | null;
  price: string; durationMinutes: number; serviceType: string;
}

export async function getPublicProfessionalServices(professionalId: string): Promise<PublicService[]> {
  const assignments = await prisma.professionalServiceAssignment.findMany({
    where: { professionalId, service: { status: ServiceStatus.ACTIVE, isPrivate: false } },
    select: {
      service: {
        select: { id: true, name: true, description: true, price: true, durationMinutes: true, serviceType: true },
      },
    },
  });
  return assignments.map((a) => ({
    id: a.service.id, name: a.service.name, description: a.service.description,
    price: a.service.price.toString(), durationMinutes: a.service.durationMinutes,
    serviceType: a.service.serviceType,
  }));
}

const ENUM_STATIC = {
  gender: ['MALE', 'FEMALE', 'OTHER'],
  professionalType: ['PSIKOLOG_KLINIS', 'PSIKOLOG_ANAK', 'PSIKIATER', 'KONSELOR'],
  serviceType: ['KONSELING', 'ASESMEN', 'WORKSHOP'],
};

export interface StaticDataResponse {
  gender: string[];
  professionalType: string[];
  serviceType: string[];
  dynamic: Record<string, Array<{ label: string; value: string; extra: unknown }>>;
}

export async function getPublicStaticData(): Promise<StaticDataResponse> {
  const rows = await prisma.staticData.findMany({
    where: { status: 1 },
    orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }],
    select: { type: true, label: true, value: true, extra: true },
  });
  const dynamic: StaticDataResponse['dynamic'] = {};
  for (const r of rows) {
    (dynamic[r.type] ??= []).push({ label: r.label, value: r.value, extra: r.extra });
  }
  return { ...ENUM_STATIC, dynamic };
}

export interface PublicBookingConfig {
  slotHoldTtlMs: number;
  minBookingNoticeMinutes: number;
  maxAdvanceDays: number;
}

export function getPublicBookingConfig(): PublicBookingConfig {
  return {
    slotHoldTtlMs: SLOT_HOLD_TTL_MS,
    minBookingNoticeMinutes: 60,
    maxAdvanceDays: 60,
  };
}
