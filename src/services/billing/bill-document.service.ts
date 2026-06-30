import { prisma } from '@/lib/db';
import { getBill, type BillDetail } from './bill.service';

export interface CurrencyFmt { currencyPrefix: string; currencyPostfix: string }

function money(n: number, c: CurrencyFmt): string {
  return `${c.currencyPrefix}${n.toFixed(2)}${c.currencyPostfix}`;
}

/** Pure HTML render of the invoice — ported from KCBillPrintTemplate.php. */
export function renderInvoiceHtml(bill: BillDetail, c: CurrencyFmt): string {
  const rows = bill.serviceItems
    .map((s) => `<tr><td>${s.service_name}</td><td>${s.quantity}</td><td>${money(s.price, c)}</td><td>${money(s.total, c)}</td></tr>`)
    .join('');
  const taxRows = bill.taxItems
    .map((t) => `<tr><td colspan="3">${t.tax_name} (${t.tax_type === 'percentage' ? `${t.tax_value}%` : 'fixed'})</td><td>${money(t.tax_amount, c)}</td></tr>`)
    .join('');
  const clinic = bill.clinic as any;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,sans-serif;color:#222;padding:24px}
    h1{font-size:20px} table{width:100%;border-collapse:collapse;margin-top:16px}
    th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:13px}
    .totals td{font-weight:bold}
  </style></head><body>
    <h1>Invoice #${bill.invoiceId}</h1>
    <p><strong>${clinic.name ?? ''}</strong> ${clinic.email ?? ''}</p>
    <p>Patient: ${(bill.patient as any).name ?? ''} &middot; Doctor: ${(bill.doctor as any).name ?? ''}</p>
    <p>Date: ${new Date(bill.date).toISOString().slice(0, 10)} &middot; Status: ${bill.status}</p>
    <table><thead><tr><th>Service</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
    <tbody>${rows}
      <tr class="totals"><td colspan="3">Subtotal</td><td>${money(bill.service_total, c)}</td></tr>
      ${taxRows}
      <tr class="totals"><td colspan="3">Discount</td><td>${money(bill.discount, c)}</td></tr>
      <tr class="totals"><td colspan="3">Total</td><td>${money(bill.total_amount, c)}</td></tr>
    </tbody></table>
  </body></html>`;
}

/** Resolve clinic currency from kc_options (kivicare settings). Falls back to no prefix. */
export async function resolveCurrency(): Promise<CurrencyFmt> {
  const opt = await prisma.kcOption.findFirst({ where: { optionName: 'kivicare_currency_setting' }, select: { optionValue: true } });
  if (!opt) return { currencyPrefix: '', currencyPostfix: '' };
  try {
    const cfg = JSON.parse(opt.optionValue) as { prefix?: string; postfix?: string };
    return { currencyPrefix: cfg.prefix ?? '', currencyPostfix: cfg.postfix ?? '' };
  } catch {
    return { currencyPrefix: '', currencyPostfix: '' };
  }
}

/** Generate a PDF buffer for a bill. Uses Puppeteer (nodejs runtime). */
export async function generateBillPdf(billId: number): Promise<Buffer> {
  const bill = await getBill(billId);
  const currency = await resolveCurrency();
  const html = renderInvoiceHtml(bill, currency);

  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '20px', bottom: '20px', left: '16px', right: '16px' } });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
