import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { KcError } from '@/lib/kc-response';
import { toNum, toMoney } from '@/lib/kc-num';
import { TaxCalculator } from './tax-calculator';

interface NormItem { serviceId: number; name: string; price: number; qty: number }

async function ensureServiceId(tx: Prisma.TransactionClient, it: NormItem): Promise<number> {
  if (it.serviceId) return it.serviceId;
  const svc = await tx.kcService.create({
    data: { type: 'bill_service', name: it.name || 'Service', price: String(it.price), status: 1, createdAt: new Date() } as any,
    select: { id: true },
  });
  return Number(svc.id);
}

function normalizeItems(items: any[]): NormItem[] {
  return items.map((it) => ({
    serviceId: Number(it.serviceId ?? it.id ?? 0),
    name: String(it.service_name ?? it.name ?? ''),
    price: toNum(it.price),
    qty: Number(it.quantity ?? it.qty ?? 1),
  }));
}

/** Fetch taxes applicable to a (clinic, doctor) context. -1 = global. */
async function fetchApplicableTaxes(clinicId: number, doctorId: number) {
  return prisma.kcTax.findMany({
    where: {
      status: 1,
      OR: [
        { clinicId: BigInt(clinicId) },
        { clinicId: -1n },
        { clinicId: null },
      ],
      AND: [
        {
          OR: [
            { doctorId: BigInt(doctorId) },
            { doctorId: -1n },
            { doctorId: null },
          ],
        },
      ],
    },
  });
}

export interface CalculateTaxResult {
  total_tax: number;
  calculated_taxes: ReturnType<TaxCalculator['getCalculatedTaxes']>;
}

export async function calculateTax(input: { clinic_id?: number; doctor_id?: number; serviceItems: any[] }): Promise<CalculateTaxResult> {
  const items = normalizeItems(input.serviceItems);
  if (items.length === 0) throw new KcError('No service items provided', 400);

  const taxes = await fetchApplicableTaxes(input.clinic_id ?? -1, input.doctor_id ?? -1);
  const calc = new TaxCalculator();
  for (const it of items) calc.addService(it.serviceId, it.name, it.price, it.qty);
  for (const t of taxes) {
    // resolve mapping-id service_id → real service id for matching
    let svcIds: number[] = [];
    if (t.serviceId && t.serviceId !== -1n) {
      const map = await prisma.kcServiceDoctorMapping.findUnique({ where: { id: t.serviceId }, select: { serviceId: true } });
      svcIds = map ? [Number(map.serviceId)] : [Number(t.serviceId)];
    }
    calc.addTax(Number(t.id), t.name ?? '', (t.taxType as any) ?? 'percentage', toNum(t.taxValue), svcIds);
  }
  calc.calculate('exclude');
  return { total_tax: calc.getTotalTax(), calculated_taxes: calc.getCalculatedTaxes() };
}

export interface BillRef { id: number; appointmentId?: number }
export interface BillCreateInput {
  serviceItems: any[]; taxItems: any[]; discount: number; discountEnabled?: boolean;
  status: 'paid' | 'unpaid'; clinic: BillRef; doctor: BillRef; patient: BillRef;
  patientEncounter: BillRef; service_total: number; total_amount: number; checkout?: boolean;
}

export async function createBill(input: BillCreateInput): Promise<{ id: number }> {
  const encounterId = BigInt(input.patientEncounter.id);

  const existing = await prisma.kcBill.findFirst({ where: { encounterId }, select: { id: true } });
  if (existing) throw new KcError('A bill already exists for this encounter', 409);

  const encounter = await prisma.kcPatientEncounter.findUnique({ where: { id: encounterId } });
  if (!encounter) throw new KcError('Encounter not found', 404);

  const items = normalizeItems(input.serviceItems);

  const billId = await prisma.$transaction(async (tx) => {
    const bill = await tx.kcBill.create({
      data: {
        encounterId,
        appointmentId: input.patientEncounter.appointmentId ? BigInt(input.patientEncounter.appointmentId) : null,
        totalAmount: String(input.total_amount),
        discount: String(input.discount ?? 0),
        actualAmount: String(input.total_amount),
        status: 0n,
        paymentStatus: input.status,
        clinicId: BigInt(input.clinic.id),
        createdAt: new Date(),
      },
      select: { id: true },
    });

    for (const it of items) {
      // Auto-create a service if the line references none.
      const serviceId = await ensureServiceId(tx, it);
      await tx.kcBillItem.create({ data: { billId: bill.id, itemId: BigInt(serviceId), qty: it.qty, price: String(it.price), createdAt: new Date() } });
    }

    // Persist applied taxes to wp_kc_tax_data (module_type='encounter').
    await tx.kcTaxData.deleteMany({ where: { moduleType: 'encounter', moduleId: encounterId } });
    for (const t of input.taxItems ?? []) {
      await tx.kcTaxData.create({ data: { moduleType: 'encounter', moduleId: encounterId, name: t.tax_name ?? '', charges: String(t.tax_amount ?? 0), taxValue: String(t.tax_value ?? 0), taxType: t.tax_type ?? 'percentage' } });
    }

    // Status side effects.
    if (input.status === 'paid') {
      await tx.kcPatientEncounter.update({ where: { id: encounterId }, data: { status: 0 } });
      // updateMany (not update) so a missing appointment row is a no-op rather than
      // throwing P2025 and rolling back the whole bill (KiviCare-lenient behavior).
      if (encounter.appointmentId) await tx.kcAppointment.updateMany({ where: { id: encounter.appointmentId }, data: { status: 3 } as any });
      // TODO(followup-slice): fire kc_appointment_updated hook + Google Calendar sync
    } else {
      await tx.kcPatientEncounter.update({ where: { id: encounterId }, data: { status: 1 } });
    }
    return bill.id;
  });

  return { id: Number(billId) };
}

export interface BillServiceItem {
  id: number; serviceId: number; service_name: string; quantity: number; price: number; total: number;
}
export interface BillTaxItem { id: number; tax_name: string; tax_type: string; tax_value: number; tax_amount: number; }
export interface BillDetail {
  id: number; invoiceId: number; date: Date; status: string;
  clinic: { id: number }; doctor: { id: number }; patient: { id: number };
  patientEncounter: { id: number; appointmentId: number | null };
  serviceItems: BillServiceItem[]; service_total: number; discount: number;
  totalTax: number; taxItems: BillTaxItem[]; total_amount: number; actual_amount: number;
}

export async function getBill(id: number): Promise<BillDetail> {
  const bill = await prisma.kcBill.findUnique({ where: { id: BigInt(id) } });
  if (!bill) throw new KcError('Bill not found', 404);

  const encounter = await prisma.kcPatientEncounter.findUnique({ where: { id: bill.encounterId }, select: { doctorId: true, patientId: true } });

  const items = await prisma.kcBillItem.findMany({ where: { billId: bill.id } });
  const serviceIds = items.map((i) => i.itemId);
  const services = await prisma.kcService.findMany({ where: { id: { in: serviceIds } }, select: { id: true, name: true } });
  const nameById = new Map(services.map((s) => [s.id.toString(), s.name]));

  const serviceItems: BillServiceItem[] = items.map((i) => {
    const price = toNum(i.price); const total = toMoney(price * i.qty);
    return { id: Number(i.id), serviceId: Number(i.itemId), service_name: nameById.get(i.itemId.toString()) ?? '', quantity: i.qty, price, total };
  });
  const service_total = toMoney(serviceItems.reduce((a, s) => a + s.total, 0));

  const taxRows = await prisma.kcTaxData.findMany({ where: { moduleType: 'encounter', moduleId: bill.encounterId } });
  const taxItems: BillTaxItem[] = taxRows.map((t) => ({ id: Number(t.id), tax_name: t.name ?? '', tax_type: t.taxType ?? 'percentage', tax_value: toNum(t.taxValue), tax_amount: toNum(t.charges) }));
  const totalTax = toMoney(taxItems.reduce((a, t) => a + t.tax_amount, 0));
  const discount = toNum(bill.discount);

  return {
    id: Number(bill.id), invoiceId: Number(bill.id), date: bill.createdAt, status: bill.paymentStatus ?? 'unpaid',
    clinic: { id: Number(bill.clinicId ?? 0) }, doctor: { id: Number(encounter?.doctorId ?? 0) }, patient: { id: Number(encounter?.patientId ?? 0) },
    patientEncounter: { id: Number(bill.encounterId), appointmentId: bill.appointmentId ? Number(bill.appointmentId) : null },
    serviceItems, service_total, discount, totalTax, taxItems,
    total_amount: toNum(bill.totalAmount), actual_amount: toNum(bill.actualAmount),
  };
}

interface BillSkeleton {
  status: string;
  clinic: { id: number };
  patient: { id: number };
  doctor: { id: number };
  patientEncounter: { id: number; appointmentId: number | null };
  serviceItems: BillServiceItem[];
}

export async function getBillByEncounter(encounterId: number): Promise<{ status: string } | BillDetail | BillSkeleton> {
  const bill = await prisma.kcBill.findFirst({ where: { encounterId: BigInt(encounterId) }, select: { id: true } });
  if (bill) return getBill(Number(bill.id));
  const enc = await prisma.kcPatientEncounter.findUnique({ where: { id: BigInt(encounterId) } });
  if (!enc) return { status: 'unpaid' };
  return {
    // skeleton mirrors KiviCare's "Bill not found for this encounter" payload
    status: 'unpaid',
    clinic: { id: Number(enc.clinicId) }, patient: { id: Number(enc.patientId) }, doctor: { id: Number(enc.doctorId) },
    patientEncounter: { id: Number(enc.id), appointmentId: enc.appointmentId ? Number(enc.appointmentId) : null }, serviceItems: [],
  };
}

export async function updateBill(id: number, input: BillCreateInput): Promise<{ id: number }> {
  const bill = await prisma.kcBill.findUnique({ where: { id: BigInt(id) } });
  if (!bill) throw new KcError('Bill not found', 404);
  const items = normalizeItems(input.serviceItems);
  await prisma.$transaction(async (tx) => {
    await tx.kcBill.update({
      where: { id: BigInt(id) },
      data: { totalAmount: String(input.total_amount), discount: String(input.discount ?? 0), actualAmount: input.total_amount !== undefined ? String(input.total_amount) : undefined, paymentStatus: input.status },
    });
    await tx.kcBillItem.deleteMany({ where: { billId: BigInt(id) } });
    for (const it of items) {
      const serviceId = await ensureServiceId(tx, it);
      await tx.kcBillItem.create({ data: { billId: BigInt(id), itemId: BigInt(serviceId), qty: it.qty, price: String(it.price), createdAt: new Date() } });
    }
    await tx.kcTaxData.deleteMany({ where: { moduleType: 'encounter', moduleId: bill.encounterId } });
    for (const t of input.taxItems ?? []) await tx.kcTaxData.create({ data: { moduleType: 'encounter', moduleId: bill.encounterId, name: t.tax_name ?? '', charges: String(t.tax_amount ?? 0), taxValue: String(t.tax_value ?? 0), taxType: t.tax_type ?? 'percentage' } });
    if (input.checkout || input.status === 'paid') {
      await tx.kcPatientEncounter.update({ where: { id: bill.encounterId }, data: { status: 0 } });
      if (bill.appointmentId) await tx.kcAppointment.update({ where: { id: bill.appointmentId }, data: { status: 3 } as any });
    }
  });
  return { id };
}

export async function updateBillItem(itemId: number, input: { serviceId: number; quantity: number; price: number }): Promise<{ id: number }> {
  const item = await prisma.kcBillItem.findUnique({ where: { id: BigInt(itemId) } });
  if (!item) throw new KcError('Bill item not found', 404);
  await prisma.kcBillItem.update({ where: { id: BigInt(itemId) }, data: { itemId: BigInt(input.serviceId), qty: input.quantity, price: String(input.price) } });
  return { id: itemId };
}

export async function deleteBillItem(itemId: number): Promise<{ id: number }> {
  const item = await prisma.kcBillItem.findUnique({ where: { id: BigInt(itemId) } });
  if (!item) throw new KcError('Bill item not found', 404);
  await prisma.kcBillItem.delete({ where: { id: BigInt(itemId) } });
  return { id: itemId };
}

export interface BillScope { clinicId?: bigint; doctorId?: bigint; patientId?: bigint }

export interface BillListParams {
  search?: string; status?: string; date_from?: string; date_to?: string;
  page: number; perPage: number | 'all'; orderBy?: string; order?: string;
  id?: number; encounter_id?: number; doctorName?: string; clinicName?: string; patientName?: string; serviceName?: string;
}

const BILL_SORT: Record<string, string> = {
  invoiceId: 'bills.id', id: 'bills.id', encounter_id: 'bills.encounter_id',
  total_amount: 'CAST(bills.total_amount AS DECIMAL(10,2))', discount: 'CAST(bills.discount AS DECIMAL(10,2))',
  actual_amount: 'CAST(bills.actual_amount AS DECIMAL(10,2))', date: 'bills.created_at', status: 'bills.payment_status',
};

export async function listBills(p: BillListParams, scope: BillScope | null) {
  const where: string[] = ['1=1']; const args: any[] = [];
  if (p.id) { where.push('bills.id = ?'); args.push(p.id); }
  if (p.encounter_id) { where.push('bills.encounter_id = ?'); args.push(p.encounter_id); }
  if (p.status) { where.push('bills.payment_status = ?'); args.push(p.status); }
  if (p.date_from) { where.push('DATE(bills.created_at) >= ?'); args.push(p.date_from); }
  if (p.date_to) { where.push('DATE(bills.created_at) <= ?'); args.push(p.date_to); }
  if (scope?.clinicId !== undefined) { where.push('bills.clinic_id = ?'); args.push(Number(scope.clinicId)); }
  if (scope?.doctorId !== undefined) { where.push('pe.doctor_id = ?'); args.push(Number(scope.doctorId)); }
  if (scope?.patientId !== undefined) { where.push('pe.patient_id = ?'); args.push(Number(scope.patientId)); }
  if (p.search) {
    where.push('(bills.id LIKE ? OR clinics.name LIKE ? OR bills.payment_status LIKE ?)');
    args.push(`%${p.search}%`, `%${p.search}%`, `%${p.search}%`);
  }
  const whereSql = where.join(' AND ');

  const countRows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
    `SELECT COUNT(DISTINCT bills.id) c
     FROM wp_kc_bills bills
     LEFT JOIN wp_kc_patient_encounters pe ON bills.encounter_id = pe.id
     LEFT JOIN wp_kc_clinics clinics ON bills.clinic_id = clinics.id
     WHERE ${whereSql}`, ...args);
  const total = Number(countRows[0]?.c ?? 0);

  const orderCol = BILL_SORT[p.orderBy ?? 'id'] ?? 'bills.id';
  const orderDir = (p.order ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const perPage = p.perPage === 'all' ? total || 1 : (p.perPage as number);
  const limitSql = p.perPage === 'all' ? '' : `LIMIT ${perPage} OFFSET ${(p.page - 1) * perPage}`;

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT bills.*, pe.doctor_id, pe.patient_id, pe.appointment_id,
            clinics.name AS clinic_name, clinics.email AS clinic_email,
            d.display_name AS doctor_name, d.user_email AS doctor_email,
            pt.display_name AS patient_name, pt.user_email AS patient_email
     FROM wp_kc_bills bills
     LEFT JOIN wp_kc_patient_encounters pe ON bills.encounter_id = pe.id
     LEFT JOIN wp_kc_clinics clinics ON bills.clinic_id = clinics.id
     LEFT JOIN wp_users d ON pe.doctor_id = d.ID
     LEFT JOIN wp_users pt ON pe.patient_id = pt.ID
     WHERE ${whereSql}
     GROUP BY bills.id
     ORDER BY ${orderCol} ${orderDir}
     ${limitSql}`, ...args);

  const billings = rows.map((r) => ({
    id: Number(r.id), invoiceId: Number(r.id), encounter_id: Number(r.encounter_id), date: r.created_at,
    status: r.payment_status ?? 'unpaid',
    patient: { name: r.patient_name ?? '', email: r.patient_email ?? '' },
    clinic: { id: Number(r.clinic_id ?? 0), name: r.clinic_name ?? '', email: r.clinic_email ?? '' },
    doctor: { id: Number(r.doctor_id ?? 0), name: r.doctor_name ?? '', email: r.doctor_email ?? '' },
    services: '', discount: toNum(r.discount), total_amount: toNum(r.total_amount), actual_amount: toNum(r.actual_amount),
  }));

  return { billings, pagination: { total, perPage, currentPage: p.page, lastPage: Math.max(1, Math.ceil(total / perPage)) } };
}

export async function encountersWithoutBill(scope: BillScope | null) {
  const where: string[] = ['pe.id NOT IN (SELECT encounter_id FROM wp_kc_bills WHERE encounter_id IS NOT NULL)'];
  const args: any[] = [];
  if (scope?.clinicId !== undefined) { where.push('pe.clinic_id = ?'); args.push(Number(scope.clinicId)); }
  if (scope?.doctorId !== undefined) { where.push('pe.doctor_id = ?'); args.push(Number(scope.doctorId)); }
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT pe.*, c.name AS clinic_name, d.display_name AS doctor_name, pt.display_name AS patient_name
     FROM wp_kc_patient_encounters pe
     LEFT JOIN wp_kc_clinics c ON pe.clinic_id = c.id
     LEFT JOIN wp_users d ON pe.doctor_id = d.ID
     LEFT JOIN wp_users pt ON pe.patient_id = pt.ID
     WHERE ${where.join(' AND ')}
     ORDER BY pe.id DESC`, ...args);
  const encounters = rows.map((r) => ({
    id: Number(r.id), encounterDate: r.encounter_date, patientId: Number(r.patient_id), clinicId: Number(r.clinic_id),
    doctorId: Number(r.doctor_id), status: r.status, description: r.description ?? '', appointmentId: r.appointment_id ? Number(r.appointment_id) : null,
    patientName: r.patient_name ?? '', clinicName: r.clinic_name ?? '', doctorName: r.doctor_name ?? '',
  }));
  return { encounters, count: encounters.length };
}

export async function exportBills(p: BillListParams, scope: BillScope | null) {
  const list = await listBills({ ...p, perPage: 'all' }, scope);
  const bills = list.billings.map((b) => ({
    id: b.id, total_amount: b.total_amount, discount: b.discount || '-', actual_amount: b.actual_amount,
    encounter_id: b.encounter_id, clinic_id: b.clinic.id, doctor_id: b.doctor.id, patient_id: 0,
    status: b.status, doctor_name: b.doctor.name, patient_name: b.patient.name, clinic_name: b.clinic.name, service_name: b.services,
  }));
  return { bills };
}
