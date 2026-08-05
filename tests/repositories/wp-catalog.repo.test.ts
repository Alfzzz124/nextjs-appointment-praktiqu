/**
 * Contract tests for the WordPress clinic + service read repositories.
 *
 * Clinics live in `wp_kc_clinics` and services in `wp_kc_services` — not in our
 * `clinics` / `services` shadow tables. See docs/architecture/shadow-tables-audit.md.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../billing/fixtures';
import { findClinicById, listClinics } from '@/repositories/wp/clinics.repo';
import {
  findServiceById,
  listServices,
  listServicesForDoctor,
} from '@/repositories/wp/services.repo';

/** Test-owned range. Cleanup is bounded by END — see the note in wp-patients.repo.test.ts. */
const BASE = 8_600_000;
const END = BASE + 100_000;

describe('wp catalog repositories', () => {
  beforeAll(async () => {
    assertTestDb();
    await prisma.kcServiceDoctorMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
    await prisma.kcService.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
    await prisma.kcClinic.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });

    await prisma.kcClinic.createMany({
      data: [
        {
          id: BigInt(BASE + 1),
          name: 'Klinik Sehat',
          email: 'klinik@test.local',
          telephoneNo: '0221234567',
          address: 'Jl. Asia Afrika 1',
          city: 'Bandung',
          country: 'Indonesia',
          postalCode: '40111',
          specialties: JSON.stringify(['Psikologi', 'Psikiatri']),
          status: 1,
          clinicAdminId: 1n,
          clinicLogo: 0n,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: BigInt(BASE + 2),
          name: 'Klinik Nonaktif',
          status: 0,
          clinicAdminId: 1n,
          clinicLogo: 0n,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ] as never,
    });

    await prisma.kcService.createMany({
      data: [
        {
          id: BigInt(BASE + 1),
          name: 'Konseling Individu',
          type: 'system_service',
          price: '250000',
          category: JSON.stringify({ name: 'Konseling' }),
          status: 1,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: BigInt(BASE + 2),
          name: 'Layanan Arsip',
          type: 'system_service',
          price: '0',
          status: 0,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ] as never,
    });

    await prisma.kcServiceDoctorMapping.create({
      data: {
        id: BigInt(BASE + 1),
        serviceId: BigInt(BASE + 1),
        doctorId: BigInt(BASE + 77),
        clinicId: BigInt(BASE + 1),
        charges: '300000',
        duration: 60,
        status: 1,
        isPublic: 1,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      } as never,
    });
  });

  afterAll(async () => {
    await prisma.kcServiceDoctorMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
    await prisma.kcService.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
    await prisma.kcClinic.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
    await prisma.$disconnect();
  });

  describe('clinics', () => {
    it('reads a clinic from wp_kc_clinics', async () => {
      const clinic = await findClinicById(BigInt(BASE + 1));

      expect(clinic).not.toBeNull();
      expect(clinic!.name).toBe('Klinik Sehat');
      expect(clinic!.city).toBe('Bandung');
      expect(clinic!.isActive).toBe(true);
    });

    it('decodes the specialties LongText JSON', async () => {
      const clinic = await findClinicById(BigInt(BASE + 1));
      expect(clinic!.specialties).toEqual(['Psikologi', 'Psikiatri']);
    });

    it('returns an empty specialties array when the column is null', async () => {
      const clinic = await findClinicById(BigInt(BASE + 2));
      expect(clinic!.specialties).toEqual([]);
    });

    it('exposes status as a boolean and lists only active clinics by default', async () => {
      const { items } = await listClinics({ page: 1, perPage: 50 });
      const ids = items.map((c) => Number(c.id));

      expect(ids).toContain(BASE + 1);
      expect(ids).not.toContain(BASE + 2);
    });

    it('includes inactive clinics when asked', async () => {
      const { items } = await listClinics({ page: 1, perPage: 50, includeInactive: true });
      const ids = items.map((c) => Number(c.id));

      expect(ids).toContain(BASE + 1);
      expect(ids).toContain(BASE + 2);
    });

    it('returns null for an unknown clinic', async () => {
      expect(await findClinicById(BigInt(BASE + 999))).toBeNull();
    });
  });

  describe('services', () => {
    it('reads a service from wp_kc_services', async () => {
      const service = await findServiceById(BigInt(BASE + 1));

      expect(service).not.toBeNull();
      expect(service!.name).toBe('Konseling Individu');
      expect(service!.price).toBe('250000');
      expect(service!.isActive).toBe(true);
    });

    it('lists only active services by default', async () => {
      const { items } = await listServices({ page: 1, perPage: 50 });
      const ids = items.map((s) => Number(s.id));

      expect(ids).toContain(BASE + 1);
      expect(ids).not.toContain(BASE + 2);
    });

    it('searches by name', async () => {
      const { items } = await listServices({ page: 1, perPage: 50, search: 'Konseling' });
      expect(items.map((s) => Number(s.id))).toEqual([BASE + 1]);
    });

    it('resolves a doctor’s services with per-doctor charges and duration', async () => {
      const rows = await listServicesForDoctor({
        doctorId: BigInt(BASE + 77),
        clinicId: BigInt(BASE + 1),
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].serviceId).toBe(BigInt(BASE + 1));
      expect(rows[0].name).toBe('Konseling Individu');
      // The mapping's charge overrides the service's base price.
      expect(rows[0].charges).toBe('300000');
      expect(rows[0].durationMinutes).toBe(60);
      expect(rows[0].isPublic).toBe(true);
    });

    it('returns no services for a doctor with no mappings', async () => {
      const rows = await listServicesForDoctor({
        doctorId: BigInt(BASE + 78),
        clinicId: BigInt(BASE + 1),
      });
      expect(rows).toEqual([]);
    });
  });
});
