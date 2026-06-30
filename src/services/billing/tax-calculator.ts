import { toMoney } from '@/lib/kc-num';

export type TaxType = 'percentage' | 'fixed';
export type TaxMode = 'include' | 'exclude';

interface Svc { id: number; name: string; price: number; qty: number }
interface Tx { taxId: number; name: string; type: TaxType; value: number; serviceIds: number[] }

export interface CalculatedTax {
  tax_id: number;
  tax_name: string;
  tax_type: TaxType;
  tax_value: number;
  tax_amount: number;
  service_id: number;
  service_name: string;
}

export interface TaxSummaryRow {
  tax_id: number;
  tax_name: string;
  tax_type: TaxType;
  tax_value: number;
  tax_amount: number;
}

export class TaxCalculator {
  private services: Svc[] = [];
  private taxes: Tx[] = [];
  private calculated: CalculatedTax[] = [];

  addService(id: number, name: string, price: number, qty: number): void {
    this.services.push({ id, name, price, qty });
  }

  /** serviceIds omitted/empty or containing -1 = global (all services). */
  addTax(taxId: number, name: string, type: TaxType, value: number, serviceIds: number[] = []): void {
    this.taxes.push({ taxId, name, type, value, serviceIds });
  }

  private applies(tax: Tx, serviceId: number): boolean {
    if (tax.serviceIds.length === 0) return true;
    if (tax.serviceIds.includes(-1)) return true;
    return tax.serviceIds.includes(serviceId);
  }

  calculate(mode: TaxMode = 'exclude'): void {
    this.calculated = [];
    for (const s of this.services) {
      const gross = s.price * s.qty;
      const applicable = this.taxes.filter((t) => this.applies(t, s.id));

      // For include mode, derive the base by dividing out total percentage.
      let base = gross;
      if (mode === 'include') {
        const pctSum = applicable
          .filter((t) => t.type === 'percentage')
          .reduce((acc, t) => acc + t.value, 0);
        const fixedSum = applicable
          .filter((t) => t.type === 'fixed')
          .reduce((acc, t) => acc + t.value, 0);
        base = (gross - fixedSum) / (1 + pctSum / 100);
      }

      for (const t of applicable) {
        const amount =
          t.type === 'percentage' ? (base * t.value) / 100 : t.value;
        this.calculated.push({
          tax_id: t.taxId,
          tax_name: t.name,
          tax_type: t.type,
          tax_value: t.value,
          tax_amount: toMoney(amount),
          service_id: s.id,
          service_name: s.name,
        });
      }
    }
  }

  getCalculatedTaxes(): CalculatedTax[] {
    return this.calculated;
  }

  getTotalTax(): number {
    return toMoney(this.calculated.reduce((acc, c) => acc + c.tax_amount, 0));
  }

  getTaxSummary(): TaxSummaryRow[] {
    const byId = new Map<number, TaxSummaryRow>();
    for (const c of this.calculated) {
      const existing = byId.get(c.tax_id);
      if (existing) existing.tax_amount = toMoney(existing.tax_amount + c.tax_amount);
      else byId.set(c.tax_id, {
        tax_id: c.tax_id, tax_name: c.tax_name, tax_type: c.tax_type,
        tax_value: c.tax_value, tax_amount: c.tax_amount,
      });
    }
    return [...byId.values()];
  }
}
