# Report Print and Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last two 501 stubs under `patient-medical-reports` — `GET /{id}/print` streams the uploaded document, `POST /{id}/send-email` emails it as an attachment.

**Architecture:** A report is an uploaded file, not something we render, so `print` hands over the bytes — the same operation `/content` already performs. One shared helper (`reportFileResponse`) backs both routes. Emailing is a separate service that takes an already-resolved recipient; only the route knows the caller's role, so only the route decides who receives it.

**Tech Stack:** Next.js 14 App Router (nodejs runtime), Prisma 5 over the WordPress MySQL database, Resend via `@/lib/email`, vitest.

Spec: `docs/superpowers/specs/2026-09-11-report-print-and-email-design.md`

## Global Constraints

- **Copy register.** This product moves KiviCare, written for medical clinics, to a psychology practice. Every string a client reads uses **sesi**, **klien**, **psikolog** — never "pasien", "dokter", or "medis". Precedent: `src/services/session/reminder-email.ts`. Table and column names (`wp_kc_patient_medical_report`, `patient_id`) stay as they are; nobody reads those.
- **Email copy is Indonesian.**
- **Subject line never contains the document's name.** Subjects appear in lock-screen notifications.
- **Attachment cap: 15 MB raw**, counted while reading the stream, never from `Content-Length`.
- `vitest.config.ts` sets neither `clearMocks` nor `restoreMocks`. Every test file resets its own mocks in `beforeEach`.
- Run tests with `npx vitest run <path>`. Type-check with `npx tsc --noEmit`.
- Never run `prisma db push` or `migrate dev` — `DATABASE_URL` is the live WordPress database.

## File Structure

| File | Responsibility |
|---|---|
| `src/services/billing/report-file.ts` | **new** — build the streaming `NextResponse` for one report document: scope check, media fetch, disposition decision. |
| `src/app/api/v1/patient-medical-reports/[id]/content/route.ts` | **modify** — becomes a caller of the helper. |
| `src/app/api/v1/patient-medical-reports/[id]/print/route.ts` | **modify** — 501 stub becomes a caller of the helper. |
| `src/services/billing/report-email.service.ts` | **new** — attachment name, email copy, size cap, send. Takes a finished recipient address. |
| `src/app/api/v1/patient-medical-reports/[id]/send-email/route.ts` | **modify** — 501 stub becomes recipient policy + call. |
| `tests/billing/encounter-documents-routes.integration.test.ts` | **modify** — append a `/print` describe block beside the existing `/content` one. |
| `tests/billing/report-email.service.test.ts` | **new** — service-level tests. |
| `tests/billing/report-email-route.test.ts` | **new** — recipient-policy tests. |

---

### Task 1: Extract the shared file-streaming helper

Pure refactor. `/content` has ten existing tests in `tests/billing/encounter-documents-routes.integration.test.ts` covering 401, the CLIENT path, the no-file 404, three upstream-failure 502s, and three inline-vs-attachment cases. **Those tests are the safety net: they must pass unchanged, and you must not edit them in this task.**

**Files:**
- Create: `src/services/billing/report-file.ts`
- Modify: `src/app/api/v1/patient-medical-reports/[id]/content/route.ts`

**Interfaces:**
- Consumes: `getMedReport(id, scope)` from `@/services/billing/patient-medical-report.service`, `fetchMedia(mediaId)` from `@/lib/wp-endpoint`, `contentDispositionFor(mimeType, filename)` from `@/lib/http/content-disposition`.
- Produces: `reportFileResponse(id: number, scope: MedReportScope | null): Promise<NextResponse>` — used by Task 2.

- [ ] **Step 1: Run the existing `/content` tests and record that they pass**

Run: `npx vitest run tests/billing/encounter-documents-routes.integration.test.ts`
Expected: PASS. Note the test count — the same count must pass at the end of this task.

- [ ] **Step 2: Create the helper**

Create `src/services/billing/report-file.ts`:

```ts
/**
 * Stream a client's uploaded report document.
 *
 * Two routes hand back the same bytes. `/content` is the view-or-download link,
 * and `/print` is what the front-end fetches as a blob before opening the print
 * dialog. They are one operation published under two names, so the policy lives
 * here once instead of being copied and then drifting apart.
 *
 * This deliberately departs from KiviCare Pro's own `printReport()`
 * (`Wordpress-Plugin/kivicare-pro/app/controllers/api/KCProPatientMedicalReportController.php:716`),
 * which sets `Content-Disposition: inline` for every type it serves. An uploaded
 * `.html` or `.svg` served inline runs as script on this origin, where the
 * signed-in session lives, so `contentDispositionFor` downgrades everything
 * outside the five types `validateUpload` sniffs to `attachment`. A clinician can
 * still download a legitimate `.docx`; it just will not render in the page.
 */
import { NextResponse } from 'next/server';
import { KcError, kcFail } from '@/lib/kc-response';
import { getMedReport } from '@/services/billing/patient-medical-report.service';
import type { MedReportScope } from '@/services/billing/med-report-scope';
import { fetchMedia } from '@/lib/wp-endpoint';
import { contentDispositionFor } from '@/lib/http/content-disposition';

export async function reportFileResponse(
  id: number,
  scope: MedReportScope | null,
): Promise<NextResponse> {
  try {
    // Scope + existence. Throws 404 when the document is outside the caller's rows.
    const report = await getMedReport(id, scope);

    const mediaId = Number.parseInt(String(report.upload_report), 10);
    if (!Number.isFinite(mediaId)) {
      return kcFail('Document has no file', 404);
    }

    const media = await fetchMedia(mediaId);

    const headers = new Headers({
      'Content-Type': media.contentType,
      'Content-Disposition': contentDispositionFor(media.contentType, report.name ?? media.filename),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    if (media.contentLength !== null) {
      headers.set('Content-Length', String(media.contentLength));
    }

    return new NextResponse(media.body as any, { status: 200, headers });
  } catch (err) {
    if (err instanceof KcError) return kcFail(err.message, err.httpStatus);
    // The upstream message can name a filesystem path; it never reaches the client.
    // eslint-disable-next-line no-console
    console.error('[report-file] failed', err);
    return kcFail('Could not read the document', 502);
  }
}
```

- [ ] **Step 3: Rewrite the `/content` route to call it**

Replace the whole of `src/app/api/v1/patient-medical-reports/[id]/content/route.ts` with:

```ts
/**
 * GET /api/v1/patient-medical-reports/:id/content
 *
 * Streams the document's bytes. This exists because the URL WordPress reports for
 * these files cannot be opened: `uploads/kivicare-reports/` is `Deny from all`.
 *
 * Deliberately not a signed URL. For as long as such a URL lived it would be a
 * bearer token for a clinical document, and URLs end up in chat logs and access
 * logs. Every request is authorised here instead.
 *
 * The streaming itself lives in `reportFileResponse`, shared with `/print`.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { KcError, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { medReportScopeFor } from '@/services/billing/med-report-scope';
import { reportFileResponse } from '@/services/billing/report-file';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const { actor, params } = ctx as any;
  try {
    assertCan(actor, 'patient_report_read');
    const kc = await resolveKcActor(actor);
    return await reportFileResponse(Number(params.id), medReportScopeFor(kc));
  } catch (err) {
    // `assertCan` and `resolveKcActor` throw KcError (403); everything past them
    // is already handled inside the helper.
    if (err instanceof KcError) return kcFail(err.message, err.httpStatus);
    // eslint-disable-next-line no-console
    console.error('[report-content] failed', err);
    return kcFail('Could not read the document', 502);
  }
});
```

- [ ] **Step 4: Run the safety net**

Run: `npx vitest run tests/billing/encounter-documents-routes.integration.test.ts`
Expected: PASS, the same test count as Step 1. If any test fails, the refactor changed behaviour — fix the helper, not the test.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "report-file|patient-medical-reports" | head`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/services/billing/report-file.ts "src/app/api/v1/patient-medical-reports/[id]/content/route.ts"
git commit -m "refactor(reports): one helper behind the document stream

/print is about to serve exactly these bytes, and two copies of a
disposition decision that protects the session origin would drift."
```

---

### Task 2: `GET /{id}/print`

**Files:**
- Modify: `src/app/api/v1/patient-medical-reports/[id]/print/route.ts` (replace the 501 stub)
- Modify: `tests/billing/encounter-documents-routes.integration.test.ts` (append a describe block)
- Modify: `docs/api/openapi.yaml`, `docs/api/API-ACCESS-GUIDE.md`

**Interfaces:**
- Consumes: `reportFileResponse(id, scope)` from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

Append this describe block to the **end** of `tests/billing/encounter-documents-routes.integration.test.ts`. The file already mocks `@/lib/db` at module scope and defines `token()` and `reqWith()` helpers near the top — reuse them, do not redefine them.

Add this import beside the existing route imports at the top of the file:

```ts
import { GET as reportPrintGET } from '@/app/api/v1/patient-medical-reports/[id]/print/route';
```

Then append:

```ts
/**
 * `/print` serves the same bytes as `/content`. These tests are not a copy of the
 * `/content` suite for its own sake: they pin that the print route actually goes
 * through the shared helper, so the inline/attachment protection cannot be lost
 * by someone later giving `/print` its own streaming code — which is exactly what
 * KiviCare Pro's own controller does, inline for every type.
 */
describe('GET /patient-medical-reports/:id/print', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.user.findUnique as any).mockResolvedValue({ wpUserId: 9000001n });
    (prisma.$queryRawUnsafe as any).mockResolvedValue([]);
    process.env.WORDPRESS_SERVICE_TOKEN = 'test-token';
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('rejects a request with no token (401)', async () => {
    const res = await reportPrintGET(
      new NextRequest('http://localhost/api/v1/patient-medical-reports/1/print'),
      { params: { id: '1' } } as any,
    );
    expect(res.status).toBe(401);
  });

  it('no longer answers 501', async () => {
    const res = await reportPrintGET(
      reqWith(await token('SUPER_ADMIN'), 'http://localhost/api/v1/patient-medical-reports/1/print'),
      { params: { id: '1' } } as any,
    );
    expect(res.status).not.toBe(501);
  });

  it('streams the document bytes', async () => {
    (prisma.$queryRawUnsafe as any).mockResolvedValueOnce([
      { id: 1, name: 'Laporan sesi 3', patient_id: 9000001, upload_report: '42', date: new Date('2026-01-01') },
    ]);
    globalThis.fetch = vi.fn(async () =>
      new Response('PDF-BYTES', { status: 200, headers: { 'content-type': 'application/pdf' } }),
    ) as any;

    const res = await reportPrintGET(
      reqWith(await token('SUPER_ADMIN'), 'http://localhost/api/v1/patient-medical-reports/1/print'),
      { params: { id: '1' } } as any,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await res.text()).toBe('PDF-BYTES');
  });

  it('returns a clean 404 when the report has no numeric file id', async () => {
    (prisma.$queryRawUnsafe as any).mockResolvedValueOnce([
      { id: 1, name: 'Laporan sesi 3', patient_id: 9000001, upload_report: null, date: new Date('2026-01-01') },
    ]);

    const res = await reportPrintGET(
      reqWith(await token('SUPER_ADMIN'), 'http://localhost/api/v1/patient-medical-reports/1/print'),
      { params: { id: '1' } } as any,
    );

    expect(res.status).toBe(404);
    expect((await res.json()).message).toBe('Document has no file');
  });

  it('serves a declared text/html as attachment, not inline', async () => {
    (prisma.$queryRawUnsafe as any).mockResolvedValueOnce([
      { id: 1, name: 'Laporan sesi 3', patient_id: 9000001, upload_report: '42', date: new Date('2026-01-01') },
    ]);
    globalThis.fetch = vi.fn(async () =>
      new Response('<script>x</script>', { status: 200, headers: { 'content-type': 'text/html' } }),
    ) as any;

    const res = await reportPrintGET(
      reqWith(await token('SUPER_ADMIN'), 'http://localhost/api/v1/patient-medical-reports/1/print'),
      { params: { id: '1' } } as any,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment;/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/billing/encounter-documents-routes.integration.test.ts -t "print"`
Expected: FAIL — the streaming, 404 and disposition tests get 501 from the stub. The 401 test passes already (the stub authenticates).

- [ ] **Step 3: Replace the stub**

Replace the whole of `src/app/api/v1/patient-medical-reports/[id]/print/route.ts` with:

```ts
/**
 * GET /api/v1/patient-medical-reports/:id/print
 *
 * The same bytes `/content` serves. The front-end fetches this as a blob and
 * hands it to the browser's print dialog.
 *
 * A report is an uploaded file, not a document we compose, so there is nothing
 * to render into a PDF here — `name`, `patient_id`, `date` and a media id are
 * the whole row, and the clinical content is the file itself. KiviCare Pro's own
 * controller reaches the same conclusion: its `printReport()` streams the upload.
 *
 * The row-scope check, the `Deny from all` upload directory, and the
 * inline-versus-attachment decision all live in `reportFileResponse`.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { KcError, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { medReportScopeFor } from '@/services/billing/med-report-scope';
import { reportFileResponse } from '@/services/billing/report-file';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const { actor, params } = ctx as any;
  try {
    assertCan(actor, 'patient_report_read');
    const kc = await resolveKcActor(actor);
    return await reportFileResponse(Number(params.id), medReportScopeFor(kc));
  } catch (err) {
    if (err instanceof KcError) return kcFail(err.message, err.httpStatus);
    // eslint-disable-next-line no-console
    console.error('[report-print] failed', err);
    return kcFail('Could not read the document', 502);
  }
});
```

- [ ] **Step 4: Run the whole file**

Run: `npx vitest run tests/billing/encounter-documents-routes.integration.test.ts`
Expected: PASS, including the ten pre-existing `/content` tests.

- [ ] **Step 5: Drop the stub markers from the docs**

In `docs/api/API-ACCESS-GUIDE.md` line ~468, change:

```
| `GET` | `/api/v1/patient-medical-reports/{id}/print` | `patient_report_read` · _stub 501_ |
```

to:

```
| `GET` | `/api/v1/patient-medical-reports/{id}/print` | `patient_report_read` |
```

In `docs/api/openapi.yaml`, in the `get` block under `/api/v1/patient-medical-reports/{id}/print` (around line 6719), delete the line `_May return 501 (stub / not wired)._` and the blank line above it, leaving the `**Capability:**` and `**Response envelope:**` lines. Replace the envelope line with a note that this route returns bytes, not the KC envelope:

```yaml
      description: |-
        **Capability:** `patient_report_read`

        Streams the uploaded document. Returns the file bytes, not the KC
        `{status,message,data}` envelope; errors do use the envelope.
```

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit 2>&1 | grep -E "print" | head`
Expected: no output.

```bash
git add "src/app/api/v1/patient-medical-reports/[id]/print" tests/billing/encounter-documents-routes.integration.test.ts docs/api/openapi.yaml docs/api/API-ACCESS-GUIDE.md
git commit -m "feat(reports): print streams the uploaded document

A report is a file someone uploaded, so printing it means handing the
bytes over. Tests pin that it goes through the shared helper, so the
inline/attachment guard cannot be lost to a second implementation."
```

---

### Task 3: The email service

**Files:**
- Create: `src/services/billing/report-email.service.ts`
- Test: `tests/billing/report-email.service.test.ts`

**Interfaces:**
- Consumes: `getMedReport(id, scope)`, `findPatientById(id: bigint)` from `@/repositories/wp/patients.repo` (returns `{ email: string; displayName: string; clinicId: bigint | null; ... } | null`), `fetchMedia`, `sendEmail` from `@/lib/email`, `prisma.kcClinic.findUnique`.
- Produces, all used by Task 4 or its tests:
  - `emailMedReport(id: number, to: string, scope?: MedReportScope | null): Promise<true>`
  - `MAX_ATTACHMENT_BYTES: number`
  - `attachmentName(reportName: string | null, uploadFilename: string): string`
  - `renderReportEmailHtml(input: ReportEmailCopy): string`
  - `renderReportEmailText(input: ReportEmailCopy): string`
  - `interface ReportEmailCopy { clientName: string | null; reportName: string | null; clinicName: string | null }`

- [ ] **Step 1: Write the failing tests**

Create `tests/billing/report-email.service.test.ts`:

```ts
/**
 * Emailing a report is the one path that takes a clinical document off this
 * system and hands it to a mail provider. These tests pin the three things that
 * make that safe rather than merely working: the caller's row scope is carried
 * through, an oversized file fails loudly instead of vanishing into a message
 * nobody receives, and the subject line never names the document.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KcError } from '@/lib/kc-response';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: 'm1' }) }));
vi.mock('@/lib/db', () => ({
  prisma: { kcClinic: { findUnique: vi.fn().mockResolvedValue({ name: 'Klinik Tenang' }) } },
}));
vi.mock('@/services/billing/patient-medical-report.service', () => ({
  getMedReport: vi.fn().mockResolvedValue({
    id: 5, name: 'Hasil asesmen awal', patient_id: 9000001,
    upload_report: '42', date: new Date('2026-01-02'), patient_name: 'Budi Santoso',
  }),
}));
vi.mock('@/repositories/wp/patients.repo', () => ({
  findPatientById: vi.fn().mockResolvedValue({
    id: 9000001n, email: 'budi@example.test', displayName: 'Budi Santoso', clinicId: 3n,
  }),
}));
vi.mock('@/lib/wp-endpoint', () => ({ fetchMedia: vi.fn() }));

import {
  emailMedReport, attachmentName, renderReportEmailHtml, MAX_ATTACHMENT_BYTES,
} from '@/services/billing/report-email.service';
import { getMedReport } from '@/services/billing/patient-medical-report.service';
import { findPatientById } from '@/repositories/wp/patients.repo';
import { sendEmail } from '@/lib/email';
import { fetchMedia } from '@/lib/wp-endpoint';

/** A media response of exactly `size` bytes, delivered in 64 KB chunks. */
function media(size: number, contentType = 'application/pdf', filename = 'upload-42.pdf') {
  return {
    contentType,
    filename,
    contentLength: null,
    body: new ReadableStream<Uint8Array>({
      start(c) {
        let left = size;
        while (left > 0) {
          const n = Math.min(left, 64 * 1024);
          c.enqueue(new Uint8Array(n));
          left -= n;
        }
        c.close();
      },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (fetchMedia as any).mockResolvedValue(media(1024));
});

describe('emailMedReport', () => {
  it('sends the document as a base64 attachment', async () => {
    await expect(emailMedReport(5, 'budi@example.test')).resolves.toBe(true);

    expect(sendEmail).toHaveBeenCalledOnce();
    const arg = (sendEmail as any).mock.calls[0][0];
    expect(arg.to).toBe('budi@example.test');
    expect(arg.attachments).toHaveLength(1);
    expect(arg.attachments[0].content).toBe(Buffer.alloc(1024).toString('base64'));
  });

  it('forwards its scope argument to getMedReport', async () => {
    const scope = { patientId: 9000001n };
    await emailMedReport(5, 'budi@example.test', scope as any);
    expect(getMedReport).toHaveBeenCalledWith(5, scope);
  });

  it('sends nothing when the report is out of the caller\'s scope', async () => {
    (getMedReport as any).mockRejectedValueOnce(new KcError('Medical report not found', 404));

    await expect(emailMedReport(5, 'budi@example.test', { clinicId: 99n } as any))
      .rejects.toMatchObject({ httpStatus: 404 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('404s when the report row has no file', async () => {
    (getMedReport as any).mockResolvedValueOnce({
      id: 5, name: 'Hasil asesmen awal', patient_id: 9000001,
      upload_report: null, date: new Date(), patient_name: 'Budi Santoso',
    });

    await expect(emailMedReport(5, 'budi@example.test')).rejects.toMatchObject({ httpStatus: 404 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  /**
   * The cap is counted while reading, not taken from Content-Length: the header
   * is optional (fetchMedia returns null for it) and is an upstream claim either
   * way. This media reports no length at all and is still rejected.
   */
  it('refuses a document over the size cap, and sends nothing', async () => {
    (fetchMedia as any).mockResolvedValue(media(MAX_ATTACHMENT_BYTES + 1));

    await expect(emailMedReport(5, 'budi@example.test')).rejects.toMatchObject({ httpStatus: 413 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('accepts a document exactly at the cap', async () => {
    (fetchMedia as any).mockResolvedValue(media(MAX_ATTACHMENT_BYTES));

    await expect(emailMedReport(5, 'budi@example.test')).resolves.toBe(true);
  });

  it('rejects an empty recipient before touching the report', async () => {
    await expect(emailMedReport(5, '')).rejects.toMatchObject({ httpStatus: 400 });
    expect(getMedReport).not.toHaveBeenCalled();
  });

  it('turns a refused send into a 502 rather than reporting success', async () => {
    (sendEmail as any).mockResolvedValueOnce({ ok: false, error: 'domain not verified' });

    await expect(emailMedReport(5, 'budi@example.test')).rejects.toMatchObject({ httpStatus: 502 });
  });
});

describe('the subject line', () => {
  it('names the clinic, never the document', async () => {
    await emailMedReport(5, 'budi@example.test');

    const { subject } = (sendEmail as any).mock.calls[0][0];
    expect(subject).toBe('Laporan sesi dari Klinik Tenang');
    expect(subject).not.toContain('asesmen');
  });

  it('falls back when the client belongs to no clinic', async () => {
    (findPatientById as any).mockResolvedValueOnce({
      id: 9000001n, email: 'budi@example.test', displayName: 'Budi Santoso', clinicId: null,
    });

    await emailMedReport(5, 'budi@example.test');

    expect((sendEmail as any).mock.calls[0][0].subject).toBe('Laporan sesi Anda');
  });
});

describe('the email body', () => {
  it('addresses the client in the psychology register, not the medical one', () => {
    const html = renderReportEmailHtml({
      clientName: 'Budi Santoso', reportName: 'Hasil asesmen awal', clinicName: 'Klinik Tenang',
    });

    expect(html).toContain('Budi Santoso');
    expect(html).toContain('Hasil asesmen awal');
    expect(html).not.toMatch(/\b(pasien|dokter|medis)\b/i);
  });

  it('escapes a name that carries markup', () => {
    const html = renderReportEmailHtml({
      clientName: '<script>alert(1)</script>', reportName: null, clinicName: null,
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('attachmentName', () => {
  it('uses the name the clinician typed', () => {
    expect(attachmentName('Hasil asesmen awal.pdf', 'upload-42.pdf')).toBe('Hasil asesmen awal.pdf');
  });

  it('borrows the extension when the typed name has none', () => {
    expect(attachmentName('Hasil asesmen awal', 'upload-42.pdf')).toBe('Hasil asesmen awal.pdf');
  });

  it('falls back to the upload name when the report is unnamed', () => {
    expect(attachmentName(null, 'upload-42.pdf')).toBe('upload-42.pdf');
    expect(attachmentName('   ', 'upload-42.pdf')).toBe('upload-42.pdf');
  });

  it('strips characters that would break the MIME header or escape the filename', () => {
    expect(attachmentName('../../etc/passwd', 'upload-42.pdf')).not.toContain('/');
    expect(attachmentName('a"b\nc', 'upload-42.pdf')).not.toMatch(/["\n]/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/billing/report-email.service.test.ts`
Expected: FAIL — `Failed to resolve import "@/services/billing/report-email.service"`.

- [ ] **Step 3: Write the service**

Create `src/services/billing/report-email.service.ts`:

```ts
/**
 * Email a client's uploaded report to them.
 *
 * The recipient arrives already decided. Only the route knows whether the caller
 * is staff — who may send a copy to, say, a referring psychologist — or the
 * client themself, so the policy lives there and this function is handed one
 * finished address. Mirrors `emailBill` in `bill-document.service.ts`.
 *
 * Copy is Indonesian, in the register the rest of the client-facing mail uses:
 * sesi, klien, psikolog. This product moves KiviCare, written for medical
 * clinics, onto a psychology practice, and "pasien" is the wrong word for the
 * person reading this.
 */
import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import { sendEmail } from '@/lib/email';
import { fetchMedia } from '@/lib/wp-endpoint';
import { getMedReport } from '@/services/billing/patient-medical-report.service';
import { findPatientById } from '@/repositories/wp/patients.repo';
import type { MedReportScope } from '@/services/billing/med-report-scope';

/**
 * Largest document we will attach, in bytes.
 *
 * Resend accepts 40 MB, but base64 inflates the payload by about a third and
 * Gmail rejects at 25 MB, so 15 MB raw lands near 20 MB on the wire. Past this
 * we fail loudly: without a cap the failure arrives as an email that simply
 * never turns up, with nothing on our side to show for it.
 */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export interface ReportEmailCopy {
  clientName: string | null;
  reportName: string | null;
  clinicName: string | null;
}

function escapeHtml(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Read the whole stream, refusing once it passes `limit`.
 *
 * Counted here rather than read from `Content-Length`: that header is optional
 * (`fetchMedia` returns `null` when it is absent) and is an upstream claim in
 * any case. A document that lies about its size still cannot get past this.
 */
async function readCapped(stream: ReadableStream<Uint8Array>, limit: number): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new KcError(
        `Dokumen melebihi batas ${Math.floor(limit / (1024 * 1024))} MB untuk lampiran email`,
        413,
      );
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}

/** The name the client sees on the attachment: what the clinician typed, with a usable extension. */
export function attachmentName(reportName: string | null, uploadFilename: string): string {
  const safe = (reportName ?? '').replace(/[\\/\r\n"]/g, ' ').replace(/\s+/g, ' ').trim();
  if (safe === '') return uploadFilename;
  if (/\.[A-Za-z0-9]{1,8}$/.test(safe)) return safe;
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(uploadFilename)?.[0] ?? '';
  return `${safe}${ext}`;
}

export function renderReportEmailHtml(input: ReportEmailCopy): string {
  const sapaan = input.clientName?.trim() ? escapeHtml(input.clientName.trim()) : 'Bapak/Ibu';
  const nama = input.reportName?.trim() ? escapeHtml(input.reportName.trim()) : 'laporan sesi Anda';
  const dari = input.clinicName?.trim() ? ` dari ${escapeHtml(input.clinicName.trim())}` : '';

  return `<p>Halo ${sapaan},</p>
<p>Terlampir <strong>${nama}</strong>${dari}.</p>
<p>Dokumen ini bersifat pribadi. Bila Anda menerima email ini tanpa pernah memintanya, mohon beri tahu klinik dan hapus lampirannya.</p>
<p>Salam,<br>Tim klinik</p>`;
}

export function renderReportEmailText(input: ReportEmailCopy): string {
  const sapaan = input.clientName?.trim() ?? 'Bapak/Ibu';
  const nama = input.reportName?.trim() ?? 'laporan sesi Anda';
  const dari = input.clinicName?.trim() ? ` dari ${input.clinicName.trim()}` : '';

  return `Halo ${sapaan},

Terlampir ${nama}${dari}.

Dokumen ini bersifat pribadi. Bila Anda menerima email ini tanpa pernah memintanya, mohon beri tahu klinik dan hapus lampirannya.

Salam,
Tim klinik`;
}

/** The clinic's name, or null when the client is mapped to no clinic or the row is unnamed. */
async function clinicNameFor(clinicId: bigint | null): Promise<string | null> {
  if (clinicId === null) return null;
  const clinic = await prisma.kcClinic.findUnique({ where: { id: clinicId }, select: { name: true } });
  const name = clinic?.name?.trim();
  return name ? name : null;
}

export async function emailMedReport(
  id: number,
  to: string,
  scope: MedReportScope | null = null,
): Promise<true> {
  if (!to) throw new KcError('Recipient email is required', 400);

  // Scope + existence, before a single byte is fetched or sent.
  const report = await getMedReport(id, scope);

  const mediaId = Number.parseInt(String(report.upload_report), 10);
  if (!Number.isFinite(mediaId)) throw new KcError('Document has no file', 404);

  const patient = await findPatientById(BigInt(report.patient_id));
  const clinicName = await clinicNameFor(patient?.clinicId ?? null);

  // The document's own name stays out of the subject: subjects surface in
  // lock-screen notifications, and the client did not choose to publish a
  // clinical filename there. It is in the body and on the attachment instead.
  const subject = clinicName ? `Laporan sesi dari ${clinicName}` : 'Laporan sesi Anda';

  const media = await fetchMedia(mediaId);
  const bytes = await readCapped(media.body, MAX_ATTACHMENT_BYTES);

  const copy: ReportEmailCopy = {
    clientName: report.patient_name,
    reportName: report.name,
    clinicName,
  };

  const result = await sendEmail({
    to,
    subject,
    html: renderReportEmailHtml(copy),
    text: renderReportEmailText(copy),
    // A label for the audit log only. Feature 018's templates are not wired to
    // any sender; see the spec's "Di luar cakupan".
    template: 'kivicare_patient_report',
    attachments: [{
      filename: attachmentName(report.name, media.filename),
      content: bytes.toString('base64'),
    }],
  });

  if (!result.ok) throw new KcError('Failed to send the report email', 502);
  return true;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/billing/report-email.service.test.ts`
Expected: PASS, all of them.

- [ ] **Step 5: Prove the size cap test would catch its own removal**

Temporarily change `if (total > limit)` to `if (false)` in `readCapped`, run the suite, and confirm "refuses a document over the size cap" fails. Restore the line and confirm it passes again. A cap nobody can break is a cap nobody is testing.

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit 2>&1 | grep -E "report-email" | head`
Expected: no output.

```bash
git add src/services/billing/report-email.service.ts tests/billing/report-email.service.test.ts
git commit -m "feat(reports): service that emails a report as an attachment

Counts bytes while reading rather than trusting Content-Length, and keeps
the document's name out of the subject line, which is a lock-screen
notification on somebody's phone."
```

---

### Task 4: `POST /{id}/send-email`

**Files:**
- Modify: `src/app/api/v1/patient-medical-reports/[id]/send-email/route.ts` (replace the 501 stub)
- Test: `tests/billing/report-email-route.test.ts`
- Modify: `docs/api/openapi.yaml`, `docs/api/API-ACCESS-GUIDE.md`

**Interfaces:**
- Consumes: `emailMedReport(id, to, scope)` from Task 3.

**Capability note.** This route is gated by `patient_report_manage`, which is
`['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST']` — **no `CLIENT`**
(`src/services/billing/kc-permissions.ts:56`). A client therefore cannot email their own
report at all; only staff can send it to them. The `CLIENT` branch below is unreachable
today and is written anyway, as a second layer: if someone later adds `CLIENT` to that
capability, they must not silently also gain the right to choose the recipient.

- [ ] **Step 1: Write the failing tests**

Create `tests/billing/report-email-route.test.ts`:

```ts
/**
 * Who receives a clinical document is this route's whole job — the service takes
 * a finished address and asks no questions. These tests pin the policy: staff may
 * redirect a copy, the default is the client's own address, and a malformed `to`
 * never reaches the mail provider, which accepts arrays and would happily fan a
 * report out to a list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';

// `kc-permissions` imports prisma at module scope but only touches it inside
// `assertBillingEnabled`, which this route never calls. An empty stub keeps the
// suite off the database without pretending to model tables nothing reads.
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/services/billing/kc-actor', () => ({
  resolveKcActor: vi.fn(async (actor: any) => ({ actor, wpUserId: 9000001n, clinicId: 3n })),
}));
vi.mock('@/services/billing/patient-medical-report.service', () => ({
  getMedReport: vi.fn().mockResolvedValue({
    id: 5, name: 'Hasil asesmen awal', patient_id: 9000002,
    upload_report: '42', date: new Date('2026-01-02'), patient_name: 'Budi Santoso',
  }),
}));
vi.mock('@/repositories/wp/patients.repo', () => ({
  findPatientById: vi.fn().mockResolvedValue({
    id: 9000002n, email: 'budi@example.test', displayName: 'Budi Santoso', clinicId: 3n,
  }),
}));
vi.mock('@/services/billing/report-email.service', () => ({
  emailMedReport: vi.fn().mockResolvedValue(true),
}));

import { POST as sendEmailPOST } from '@/app/api/v1/patient-medical-reports/[id]/send-email/route';
import { emailMedReport } from '@/services/billing/report-email.service';
import { findPatientById } from '@/repositories/wp/patients.repo';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function token(role: string, sub = 'test-admin-9000001') {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub)
    .setExpirationTime('1h').sign(SECRET);
}

function post(jwt: string | null, body: unknown) {
  return new NextRequest('http://localhost/api/v1/patient-medical-reports/5/send-email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const ctx = { params: { id: '5' } } as any;

beforeEach(() => { vi.clearAllMocks(); });

describe('POST /patient-medical-reports/:id/send-email — the gate', () => {
  it('rejects a request with no token (401)', async () => {
    const res = await sendEmailPOST(post(null, {}), ctx);
    expect(res.status).toBe(401);
    expect(emailMedReport).not.toHaveBeenCalled();
  });

  /**
   * `patient_report_manage` does not include CLIENT, so a client cannot email
   * even their own report. Staff send it to them. If this ever starts returning
   * 200, the capability map changed and the recipient policy below needs a
   * second look.
   */
  it('denies a CLIENT (403) and sends nothing', async () => {
    const res = await sendEmailPOST(post(await token('CLIENT'), {}), ctx);
    expect(res.status).toBe(403);
    expect(emailMedReport).not.toHaveBeenCalled();
  });

  it('no longer answers 501 for an authorised caller', async () => {
    const res = await sendEmailPOST(post(await token('CLINIC_ADMIN'), {}), ctx);
    expect(res.status).not.toBe(501);
  });
});

describe('POST /patient-medical-reports/:id/send-email — the recipient', () => {
  it('defaults to the client\'s own address', async () => {
    const res = await sendEmailPOST(post(await token('CLINIC_ADMIN'), {}), ctx);

    expect(res.status).toBe(200);
    expect(emailMedReport).toHaveBeenCalledWith(5, 'budi@example.test', { clinicId: 3n });
  });

  it('lets staff redirect a copy', async () => {
    await sendEmailPOST(post(await token('PROFESSIONAL'), { to: 'rujukan@example.test' }), ctx);

    expect(emailMedReport).toHaveBeenCalledWith(5, 'rujukan@example.test', expect.anything());
  });

  it('refuses a non-string `to` (400) and sends nothing', async () => {
    // The mail provider accepts an array of recipients, so this is the
    // difference between one redirect and a fan-out.
    const res = await sendEmailPOST(
      post(await token('CLINIC_ADMIN'), { to: ['a@example.test', 'b@example.test'] }),
      ctx,
    );

    expect(res.status).toBe(400);
    expect(emailMedReport).not.toHaveBeenCalled();
  });

  it('refuses (400) when the client has no address on file', async () => {
    (findPatientById as any).mockResolvedValueOnce({
      id: 9000002n, email: '', displayName: 'Budi Santoso', clinicId: 3n,
    });

    const res = await sendEmailPOST(post(await token('CLINIC_ADMIN'), {}), ctx);

    expect(res.status).toBe(400);
    expect(emailMedReport).not.toHaveBeenCalled();
  });

  it('refuses (400) when the client row is missing entirely', async () => {
    (findPatientById as any).mockResolvedValueOnce(null);

    const res = await sendEmailPOST(post(await token('CLINIC_ADMIN'), {}), ctx);

    expect(res.status).toBe(400);
    expect(emailMedReport).not.toHaveBeenCalled();
  });

  it('accepts a body that is not JSON at all, falling back to the client address', async () => {
    const req = new NextRequest('http://localhost/api/v1/patient-medical-reports/5/send-email', {
      method: 'POST',
      headers: { authorization: `Bearer ${await token('CLINIC_ADMIN')}`, 'content-type': 'application/json' },
      body: 'not json',
    });

    const res = await sendEmailPOST(req, ctx);

    expect(res.status).toBe(200);
    expect(emailMedReport).toHaveBeenCalledWith(5, 'budi@example.test', expect.anything());
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/billing/report-email-route.test.ts`
Expected: FAIL — the stub answers 501 for every authorised case.

- [ ] **Step 3: Replace the stub**

Replace the whole of `src/app/api/v1/patient-medical-reports/[id]/send-email/route.ts` with:

```ts
/**
 * POST /api/v1/patient-medical-reports/:id/send-email
 *
 * Emails the uploaded document to the client, or — for staff — to an address of
 * their choosing. Deciding the recipient is this route's job: the service takes
 * one finished address, because only here is the caller's role known.
 *
 * Gated by `patient_report_manage`, which does not include CLIENT: a client
 * cannot email their own report, staff send it to them.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcFail, kcHandle, kcOk } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { medReportScopeFor } from '@/services/billing/med-report-scope';
import { getMedReport } from '@/services/billing/patient-medical-report.service';
import { emailMedReport } from '@/services/billing/report-email.service';
import { findPatientById } from '@/repositories/wp/patients.repo';

export const runtime = 'nodejs';

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    assertCan(actor, 'patient_report_manage');
    const kc = await resolveKcActor(actor);
    const scope = medReportScopeFor(kc);

    // 404s before anything is sent if the row is outside the caller's scope.
    const report = await getMedReport(Number(params.id), scope);

    const body = await req.json().catch(() => ({}));

    // A CLIENT may not redirect their own clinical document to an address of
    // their choosing: that turns "read my own report" into a mail relay that
    // carries attachments. Unreachable today — `patient_report_manage` excludes
    // CLIENT — and kept so that adding CLIENT to that capability later does not
    // silently hand them the recipient field as well.
    const rawTo: unknown = actor.role === 'CLIENT' ? '' : (body?.to ?? '');

    // The mail provider accepts an array of recipients, so an unvalidated `to`
    // widens one redirect into a fan-out.
    if (rawTo !== '' && typeof rawTo !== 'string') return kcFail('to must be a string', 400);

    let to: string = rawTo as string;
    if (!to) {
      const patient = await findPatientById(BigInt(report.patient_id));
      to = patient?.email ?? '';
    }
    if (!to) return kcFail('No recipient email available for this report', 400);

    await emailMedReport(Number(params.id), to, scope);
    return kcOk(true, 'Report sent successfully');
  }),
);
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/billing/report-email-route.test.ts`
Expected: PASS, all of them.

- [ ] **Step 5: Drop the stub markers from the docs**

In `docs/api/API-ACCESS-GUIDE.md` line ~469, change:

```
| `POST` | `/api/v1/patient-medical-reports/{id}/send-email` | `patient_report_manage` · _stub 501_ |
```

to:

```
| `POST` | `/api/v1/patient-medical-reports/{id}/send-email` | `patient_report_manage` |
```

In `docs/api/openapi.yaml`, under `/api/v1/patient-medical-reports/{id}/send-email` (around line 6752), replace the description with:

```yaml
      description: |-
        **Capability:** `patient_report_manage` — staff only; CLIENT is not in
        this capability and cannot email their own report.

        **Response envelope:** KC `{status,message,data}`

        Body may carry `to` (string) to redirect the copy, e.g. to a referring
        psychologist. Without it the report goes to the client's own address.
```

- [ ] **Step 6: Run the whole suite**

Run: `npx vitest run`
Expected: PASS. Compare the failure count against `main` before the branch — it must not rise.

- [ ] **Step 7: Type-check and commit**

Run: `npx tsc --noEmit 2>&1 | head`
Expected: no output about these files.

```bash
git add "src/app/api/v1/patient-medical-reports/[id]/send-email" tests/billing/report-email-route.test.ts docs/api/openapi.yaml docs/api/API-ACCESS-GUIDE.md
git commit -m "feat(reports): email a report to the client

The route decides the recipient because only it knows the caller's role.
A non-string \`to\` is refused: the provider accepts arrays, which turns
one redirect into a fan-out."
```

---

## Verification

After Task 4, confirm no stub remains in this area:

```bash
grep -rn "NOT_IMPLEMENTED" src/app/api/v1/patient-medical-reports/ || echo "none left"
```

Expected: `none left`.

The remaining repo-wide 501s (`clients`, `practices`, `professionals`, `receptionists`
resend-credentials, `sessions/regenerate-video-conference`, and
`POST /patient-medical-reports`) are out of scope and should still be there.
