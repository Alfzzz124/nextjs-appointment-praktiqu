import { describe, it, expect, vi } from 'vitest';
import { renderInvoiceHtml } from '@/services/billing/bill-document.service';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: 'm1' }) }));
vi.mock('@/services/billing/bill.service', async (orig) => {
  const actual = await (orig as any)();
  return { ...actual, getBill: vi.fn().mockResolvedValue({
    id: 7, invoiceId: 7, date: new Date(), status: 'paid',
    clinic: { id: 1, name: 'Clinic A', email: 'c@a.test' }, doctor: { id: 2, name: 'Dr B' }, patient: { id: 3, name: 'Pat C' },
    patientEncounter: { id: 9, appointmentId: null },
    serviceItems: [], service_total: 0, discount: 0, totalTax: 0, taxItems: [], total_amount: 0, actual_amount: 0,
  }) };
});
vi.mock('puppeteer', () => ({ default: { launch: vi.fn().mockResolvedValue({
  newPage: vi.fn().mockResolvedValue({ setContent: vi.fn(), pdf: vi.fn().mockResolvedValue(Buffer.from('PDF')) }),
  close: vi.fn(),
}) } }));

import { emailBill } from '@/services/billing/bill-document.service';
import { sendEmail } from '@/lib/email';

describe('bill-document html', () => {
  it('renders bill fields into HTML', () => {
    const html = renderInvoiceHtml({
      id: 7, invoiceId: 7, date: new Date('2026-01-02'), status: 'paid',
      clinic: { id: 1, name: 'Clinic A', email: 'c@a.test' } as any,
      doctor: { id: 2, name: 'Dr B' } as any, patient: { id: 3, name: 'Pat C' } as any,
      patientEncounter: { id: 9, appointmentId: null },
      serviceItems: [{ id: 1, serviceId: 1, service_name: 'Counseling', quantity: 1, price: 100, total: 100 }],
      service_total: 100, discount: 0, totalTax: 10,
      taxItems: [{ id: 1, tax_name: 'VAT', tax_type: 'percentage', tax_value: 10, tax_amount: 10 }],
      total_amount: 110, actual_amount: 110,
    } as any, { currencyPrefix: 'Rp', currencyPostfix: '' });
    expect(html).toContain('Counseling');
    expect(html).toContain('Clinic A');
    expect(html).toContain('110');
  });
});

describe('emailBill', () => {
  it('sends the invoice PDF to the patient', async () => {
    const res = await emailBill(7, 'pat@c.test');
    expect(res).toBe(true);
    expect(sendEmail).toHaveBeenCalledOnce();
  });
});
