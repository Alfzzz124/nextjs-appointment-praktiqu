import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderInvoiceHtml } from '@/services/billing/bill-document.service';
import { KcError } from '@/lib/kc-response';

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

import { emailBill, generateBillPdf } from '@/services/billing/bill-document.service';
import { getBill } from '@/services/billing/bill.service';
import { sendEmail } from '@/lib/email';

// vitest.config.ts sets neither clearMocks nor restoreMocks, so call-count/call-args
// assertions across tests need an explicit reset (mockResolvedValue set above survives
// clearAllMocks — only .mock.calls/.mock.results are wiped).
beforeEach(() => { vi.clearAllMocks(); });

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

  /**
   * `getBill` is the row-scope gate (see tests/billing/bill-scope.test.ts for the gate
   * itself). These prove `emailBill`/`generateBillPdf` actually pass the caller's
   * scope through to it, and — critically — send nothing when that gate rejects.
   * Without threading `scope` through, a CLIENT could still have any bill's invoice
   * PDF mailed out even though `getBill(id, scope)` alone would have 404'd them.
   */
  it('forwards its scope argument to getBill', async () => {
    const scope = { patientId: 3n };
    await emailBill(7, 'pat@c.test', scope as any);
    expect(getBill).toHaveBeenCalledWith(7, scope);
  });

  it('sends nothing when the bill is out of the caller\'s scope', async () => {
    (getBill as any).mockRejectedValueOnce(new KcError('Bill not found', 404));
    await expect(emailBill(7, 'pat@c.test', { patientId: 999n } as any)).rejects.toMatchObject({ httpStatus: 404 });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('generateBillPdf scope', () => {
  it('forwards its scope argument to getBill', async () => {
    const scope = { clinicId: 5n };
    await generateBillPdf(7, scope as any);
    expect(getBill).toHaveBeenCalledWith(7, scope);
  });

  it('propagates a getBill rejection rather than rendering a PDF for an out-of-scope bill', async () => {
    (getBill as any).mockRejectedValueOnce(new KcError('Bill not found', 404));
    await expect(generateBillPdf(7, { clinicId: 999n } as any)).rejects.toMatchObject({ httpStatus: 404 });
  });
});
