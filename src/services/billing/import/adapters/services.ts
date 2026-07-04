import { prisma } from '@/lib/db';
import type { ImportAdapter } from '../adapters';

export const servicesAdapter: ImportAdapter = {
  async findExisting(row) {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM wp_kc_services WHERE name = ? LIMIT 1`,
      row.name,
    );
    return rows[0] ? Number(rows[0].id) : null;
  },
  async insert(row) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_services (type, category, name, price, status, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      row.type ?? null,
      null,
      row.name,
      row.price != null ? String(row.price) : null,
      row.status,
    );
  },
  async update(id, row) {
    await prisma.$executeRawUnsafe(
      `UPDATE wp_kc_services SET price = ?, status = ? WHERE id = ?`,
      row.price != null ? String(row.price) : null, row.status, id,
    );
  },
};
