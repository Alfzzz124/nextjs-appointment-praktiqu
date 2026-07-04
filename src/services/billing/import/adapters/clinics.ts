import { prisma } from '@/lib/db';
import type { ImportAdapter } from '../adapters';

export const clinicsAdapter: ImportAdapter = {
  async findExisting(row) {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM wp_kc_clinics WHERE name = ? OR (email IS NOT NULL AND email <> '' AND email = ?) LIMIT 1`,
      row.name, row.email ?? '',
    );
    return rows[0] ? Number(rows[0].id) : null;
  },
  async insert(row) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinics
         (name, email, telephone_no, address, city, country, status, clinic_admin_id, clinic_logo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, NOW())`,
      row.name,
      row.email ?? null,
      row.telephone_no ?? null,
      row.address ?? null,
      row.city ?? null,
      row.country ?? null,
      row.status,
    );
  },
  async update(id, row) {
    await prisma.$executeRawUnsafe(
      `UPDATE wp_kc_clinics SET status = ? WHERE id = ?`,
      row.status, id,
    );
  },
};
