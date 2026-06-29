import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import { toNum, toMoney } from '@/lib/kc-num';
import { TaxCalculator } from './tax-calculator';

interface NormItem { serviceId: number; name: string; price: number; qty: number }

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
      let serviceId = it.serviceId;
      // Auto-create a service if the line references none.
      if (!serviceId) {
        const svc = await tx.kcService.create({ data: { type: 'bill_service', name: it.name || 'Service', price: String(it.price), status: 1, createdAt: new Date() } as any, select: { id: true } });
        serviceId = Number(svc.id);
      }
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
    clinic: { id: Number(bill.clinicId ?? 0) }, doctor: { id: 0 }, patient: { id: 0 },
    patientEncounter: { id: Number(bill.encounterId), appointmentId: bill.appointmentId ? Number(bill.appointmentId) : null },
    serviceItems, service_total, discount, totalTax, taxItems,
    total_amount: toMoney(service_total + totalTax - discount), actual_amount: toNum(bill.actualAmount),
  };
}

export async function getBillByEncounter(encounterId: number): Promise<{ status: string } | BillDetail> {
  const bill = await prisma.kcBill.findFirst({ where: { encounterId: BigInt(encounterId) }, select: { id: true } });
  if (bill) return getBill(Number(bill.id));
  const enc = await prisma.kcPatientEncounter.findUnique({ where: { id: BigInt(encounterId) } });
  if (!enc) return { status: 'unpaid' };
  return {
    // skeleton mirrors KiviCare's "Bill not found for this encounter" payload
    status: 'unpaid',
    // @ts-expect-error partial skeleton is intentional and matches KiviCare
    clinic: { id: Number(enc.clinicId) }, patient: { id: Number(enc.patientId) }, doctor: { id: Number(enc.doctorId) },
    patientEncounter: { id: Number(enc.id), appointmentId: enc.appointmentId ? Number(enc.appointmentId) : null }, serviceItems: [],
  };
}
