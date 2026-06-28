import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import { toNum } from '@/lib/kc-num';
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
