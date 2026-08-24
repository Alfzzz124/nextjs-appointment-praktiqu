# Encounter Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a clinician see, open, upload, rename and delete the documents attached to an encounter — both the files that arrived with the booking and the patient's report archive.

**Architecture:** Next.js routes authorise with the row-scope helpers that already exist, then fetch bytes from a new read route on the `praktiqu-endpoint` WordPress plugin over a service token, and pipe that stream to the caller. Document rows stay in `wp_kc_patient_medical_report`; the encounter link is one row per pair in `wp_kc_custom_fields_data` under a namespaced `module_type`. No new table, no new column.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma (MySQL, raw SQL where KiviCare's schema demands it), Vitest, PHP 8 (WordPress mu-plugin).

**Spec:** `docs/superpowers/specs/2026-08-24-encounter-documents-design.md`

## Global Constraints

- **Every `wp_kc_*` table is MyISAM.** No transactions, no foreign keys. `prisma.$transaction` around these tables guarantees nothing. Order writes so a partial state is coherent; never rely on rollback.
- **The encounter link row is exactly:** `module_type = 'praktiqu_report_encounter'`, `module_id = <encounter id>`, `fields_data = <report id, JSON-encoded>`, `field_id = NULL`. `field_id` must be NULL — `KCCustomField::getData()` matches on `field_id` alone and would otherwise pick our rows up.
- **One link row per (encounter, document) pair.** Never an array in one row: that would be read-modify-write on a MyISAM blob.
- **Never write `wp_kc_appointments.appointment_report`.** Read-only, always.
- **Uploads always use the `medical-report` context** (`uploads/kivicare-reports`, which is `Deny from all`). Never `custom-field` (`uploads/kivicare-uploads` is world-readable).
- **A media id is never authorised on its own.** It must be proven to belong to a row the caller may already see.
- **No signed URLs, no long-lived keys.** Every content request is authorised afresh.
- **Allowed uploads:** jpg, jpeg, png, webp, gif, pdf. Max 10 MB. Enforced by `validateUpload` — do not duplicate the rules.
- **Ids are KiviCare integers**, not cuids. Encounter id, report id, appointment/session id, WP attachment id.
- **DB-backed tests require `DATABASE_URL` to contain "test"** — `assertTestDb()` throws otherwise. Never point them at the WordPress database.
- Run `npm run type-check` before every commit. It is not optional: `strictNullChecks` is off, so discriminated unions need `result.ok === false`, not `!result.ok`.

---

## File Structure

**Create**

| Path | Responsibility |
|---|---|
| `src/repositories/wp/encounter-documents.repo.ts` | Link rows, booking attachments, WP attachment metadata. SQL only. |
| `src/services/encounter-documents/service.ts` | Assemble the two sections, apply scope, own write ordering. No SQL, no HTTP. |
| `src/app/api/v1/encounters/[id]/documents/route.ts` | `GET` list, `POST` upload |
| `src/app/api/v1/patient-medical-reports/[id]/content/route.ts` | `GET` stream a report |
| `src/app/api/v1/sessions/[id]/attachments/[mediaId]/content/route.ts` | `GET` stream a booking attachment |
| `tests/repositories/wp-encounter-documents.repo.test.ts` | DB contract tests for the repository |
| `tests/services/encounter-documents.service.test.ts` | Assembly logic with the repository mocked |
| `tests/billing/encounter-documents-routes.integration.test.ts` | Authorisation matrix + streaming |
| `docs/deploy/encounter-documents-staging-deploy.md` | Runbook |

**Modify**

| Path | Change |
|---|---|
| `src/lib/wp-endpoint.ts` | add `fetchMedia()` |
| `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-media.php` | add `stream()` |
| `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-rest-controller.php` | register `GET /media/{id}` + handler |
| `src/services/billing/patient-medical-report.service.ts` | add `renameMedReport()`; `deleteMedReport()` unlinks; `resolveReportFile()` stops returning a dead URL |
| `src/app/api/v1/patient-medical-reports/[id]/route.ts` | add `PATCH` |
| `src/app/api/v1/patient-medical-reports/[id]/file/route.ts` | return `contentPath` |
| `docs/api/openapi.yaml` | hand-written entries for the new paths |
| `docs/handover/2026-08-02-frontend-checklist.md` | a section for the new endpoints |

**Delete**

| Path | Why |
|---|---|
| `src/app/api/v1/patient-medical-reports/[id]/preview/route.ts` | a 501 stub; `/content` answers the requirement |

---

### Task 1: `fetchMedia()` — the client for the plugin's read route

**Files:**
- Modify: `src/lib/wp-endpoint.ts` (append after `uploadMedia`, currently ending at line 205)
- Test: `tests/lib/wp-endpoint-fetch-media.test.ts` (create)

**Interfaces:**
- Consumes: `WpEndpointError`, `serviceToken()`, `WP_ENDPOINT` — all already in the file
- Produces:
  ```ts
  export interface FetchedMedia {
    body: ReadableStream<Uint8Array>;
    contentType: string;
    filename: string;
    contentLength: number | null;
  }
  export async function fetchMedia(mediaId: number): Promise<FetchedMedia>
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/lib/wp-endpoint-fetch-media.test.ts`:

```ts
/**
 * `fetchMedia` is the only place bytes cross from WordPress into our process.
 * The tests below pin the three things a caller depends on: the service-token
 * header goes out, the stream and its metadata come back intact, and an upstream
 * failure becomes a WpEndpointError rather than a stream of an error page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMedia } from '@/lib/wp-endpoint';
import { WpEndpointError } from '@/lib/wp-endpoint';

const realFetch = globalThis.fetch;

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(c) { c.enqueue(bytes); c.close(); },
  });
}

async function drain(s: ReadableStream<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = s.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return new TextDecoder().decode(out);
}

beforeEach(() => {
  process.env.WP_SERVICE_TOKEN = 'test-token';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('fetchMedia', () => {
  it('sends the service token and returns the stream with its metadata', async () => {
    const seen: { url?: string; headers?: any } = {};
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      seen.url = String(url);
      seen.headers = init.headers;
      return new Response(streamOf('PDF-BYTES'), {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-length': '9',
          'content-disposition': 'inline; filename="resume.pdf"',
        },
      });
    }) as any;

    const result = await fetchMedia(42);

    expect(seen.url).toContain('/praktiqu/v1/media/42');
    expect(seen.headers['X-PraktiQU-Service-Token']).toBe('test-token');
    expect(result.contentType).toBe('application/pdf');
    expect(result.filename).toBe('resume.pdf');
    expect(result.contentLength).toBe(9);
    expect(await drain(result.body)).toBe('PDF-BYTES');
  });

  it('falls back to a safe content type and filename when the plugin omits them', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(streamOf('x'), { status: 200 })) as any;

    const result = await fetchMedia(7);

    expect(result.contentType).toBe('application/octet-stream');
    expect(result.filename).toBe('document-7');
    expect(result.contentLength).toBeNull();
  });

  it('throws WpEndpointError on a non-200 instead of streaming the error page', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('not found', { status: 404 })) as any;

    await expect(fetchMedia(9)).rejects.toBeInstanceOf(WpEndpointError);
  });

  it('throws WpEndpointError when the response carries no body', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(null, { status: 200 })) as any;

    await expect(fetchMedia(9)).rejects.toBeInstanceOf(WpEndpointError);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run tests/lib/wp-endpoint-fetch-media.test.ts
```

Expected: FAIL — `fetchMedia is not a function` / import error.

- [ ] **Step 3: Implement `fetchMedia`**

Append to `src/lib/wp-endpoint.ts`, directly below `uploadMedia`:

```ts
export interface FetchedMedia {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  filename: string;
  contentLength: number | null;
}

/**
 * Stream one attachment out of the WordPress media library.
 *
 * The bytes are never buffered here: the upstream body is handed straight to the
 * caller, which pipes it to the client. A 10 MB PDF must not become 10 MB of our
 * heap per concurrent reader.
 *
 * Authorisation is NOT performed here and cannot be — this call carries a service
 * token, not a user. Every caller must have already proven the requester may see
 * the row that owns this media id.
 */
export async function fetchMedia(mediaId: number): Promise<FetchedMedia> {
  const res = await fetch(`${WP_MEDIA_URL}/${mediaId}`, {
    method: 'GET',
    headers: { 'X-PraktiQU-Service-Token': serviceToken() },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new WpEndpointError(`Media fetch failed ${res.status}: ${text}`, res.status);
  }
  if (!res.body) {
    throw new WpEndpointError('Media fetch returned no body', res.status);
  }

  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const lengthHeader = res.headers.get('content-length');

  return {
    body: res.body as ReadableStream<Uint8Array>,
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    filename: match ? match[1] : `document-${mediaId}`,
    contentLength: lengthHeader === null ? null : Number(lengthHeader),
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run tests/lib/wp-endpoint-fetch-media.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Type-check and commit**

```bash
npm run type-check
git add src/lib/wp-endpoint.ts tests/lib/wp-endpoint-fetch-media.test.ts
git commit -m "feat(media): fetchMedia — stream an attachment out of WordPress"
```

---

### Task 2: Plugin — `GET /praktiqu/v1/media/{id}`

**Files:**
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-media.php`
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-rest-controller.php`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `GET /praktiqu/v1/media/{id}` answering with raw bytes, `Content-Type` from the attachment's `post_mime_type`, and `Content-Disposition: inline; filename="…"`. This is what Task 1's `fetchMedia` calls.

There is no PHP test harness in this repository. Verification is `php -l` plus the manual probe in step 4 — a fatal in an mu-plugin takes down the whole WordPress site, so the lint gate is not a formality.

- [ ] **Step 1: Add `Media::stream()`**

In `class-praktiqu-endpoint-media.php`, insert this method after `sideload()` and before `upload_error_message()`:

```php
    /**
     * Handle GET /praktiqu/v1/media/{id}.
     *
     * Writes the file straight to the output buffer and exits. Returning it
     * through the REST response would JSON-encode binary data, and buffering a
     * 10 MB PDF in PHP memory per request is exactly what streaming avoids.
     *
     * `exit` skips WordPress's shutdown hooks. That is deliberate and matches
     * KiviCare's own download path — there is nothing left to render once the
     * body is a file.
     *
     * No permission check here on purpose: this route is reachable only with the
     * service token, and the Next.js caller has already authorised the request
     * against a row the user may see. See the design's D3.
     *
     * @return void|\WP_Error
     */
    public function stream(\WP_REST_Request $request)
    {
        $id = (int) $request->get_param('id');

        $post = get_post($id);
        if (!$post || $post->post_type !== 'attachment') {
            return new \WP_Error('praktiqu_not_found', 'Attachment not found.', ['status' => 404]);
        }

        $path = get_attached_file($id);
        if (!is_string($path) || $path === '' || !file_exists($path)) {
            return new \WP_Error('praktiqu_file_missing', 'Attachment file is missing on disk.', ['status' => 404]);
        }

        $mime = (string) $post->post_mime_type;
        if ($mime === '') {
            $mime = 'application/octet-stream';
        }
        $filename = basename($path);
        $size = filesize($path);

        // Discard anything a plugin may have echoed before us; a single stray
        // newline corrupts a PDF.
        while (ob_get_level() > 0) {
            ob_end_clean();
        }

        header('Content-Type: ' . $mime);
        header('Content-Disposition: inline; filename="' . rawurlencode($filename) . '"');
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: private, no-store');
        if ($size !== false) {
            header('Content-Length: ' . $size);
        }

        readfile($path);
        exit;
    }
```

- [ ] **Step 2: Register the route**

In `class-praktiqu-endpoint-rest-controller.php`, immediately after the existing `register_rest_route($ns, '/media', …)` block (around line 276), add:

```php
        // GET /praktiqu/v1/media/{id} — stream one attachment's bytes
        register_rest_route($ns, '/media/(?P<id>\d+)', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'handle_media_stream'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);
```

And add the handler next to `handle_media_upload` (around line 584):

```php
    /**
     * GET /praktiqu/v1/media/{id} — streams bytes and exits, so this returns
     * only when something went wrong.
     */
    public function handle_media_stream(\WP_REST_Request $request)
    {
        $result = $this->media->stream($request);
        if (is_wp_error($result)) {
            return $result;
        }
        return rest_ensure_response(null); // unreachable: stream() exits
    }
```

- [ ] **Step 3: Lint every PHP file**

```bash
for f in $(find Wordpress-Plugin/praktiqu-endpoint -name '*.php'); do php -l "$f"; done
```

Expected: every line reads `No syntax errors detected`. If any file fails, stop and fix it — this code lands in `mu-plugins`, where a fatal takes down the live booking form.

- [ ] **Step 4: Record the manual probe**

The route cannot be exercised until the plugin is deployed. Add this to the runbook stub so Task 13 picks it up — create `docs/deploy/encounter-documents-staging-deploy.md` with:

```markdown
# Encounter documents — staging deploy

## Smoke test for `GET /praktiqu/v1/media/{id}`

Run on the staging box, replacing `<id>` with an attachment id from
`SELECT ID FROM wp_posts WHERE post_type='attachment' LIMIT 1;`

    curl -sS -o /tmp/probe.bin -D /tmp/probe.hdr \
      -H "X-PraktiQU-Service-Token: $WP_SERVICE_TOKEN" \
      "https://<wp-host>/wp-json/praktiqu/v1/media/<id>"

Expect in `/tmp/probe.hdr`: `HTTP/… 200`, a `Content-Type` matching the
attachment, and `X-Content-Type-Options: nosniff`.
Expect `/tmp/probe.bin` to open in a viewer. A zero-byte file, or one that
starts with `{`, means the headers were sent after output had already begun.

Without the token the same URL must answer 401.
```

- [ ] **Step 5: Commit**

```bash
git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-media.php \
        Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-rest-controller.php \
        docs/deploy/encounter-documents-staging-deploy.md
git commit -m "feat(plugin): GET /praktiqu/v1/media/{id} streams an attachment"
```

---

### Task 3: Repository — the encounter link rows

**Files:**
- Create: `src/repositories/wp/encounter-documents.repo.ts`
- Test: `tests/repositories/wp-encounter-documents.repo.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`
- Produces:
  ```ts
  export const ENCOUNTER_DOC_MODULE_TYPE = 'praktiqu_report_encounter';
  export async function linkReportToEncounter(encounterId: number, reportId: number): Promise<void>
  export async function unlinkReport(reportId: number): Promise<number>
  export async function listLinkedReportIds(encounterId: number): Promise<number[]>
  ```

- [ ] **Step 1: Confirm the test database has the tables**

```bash
node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{for(const t of ['wp_kc_custom_fields_data','wp_kc_patient_medical_report','wp_kc_appointments','wp_posts','wp_postmeta']){const r=await p.\$queryRawUnsafe('SHOW TABLES LIKE ?',t);console.log(t,r.length?'OK':'MISSING')}await p.\$disconnect()})()"
```

Expected: five `OK` lines. A `MISSING` means `DATABASE_URL` points at the wrong database, or the test database has drifted — stop and fix that before writing tests against it.

- [ ] **Step 2: Write the failing test**

Create `tests/repositories/wp-encounter-documents.repo.test.ts`:

```ts
/**
 * Contract tests for the encounter↔document link.
 *
 * The link is our own row inside KiviCare's custom-field table, so what matters
 * here is that it stays invisible to KiviCare (namespaced module_type, NULL
 * field_id) and that attach/detach are pure INSERT and DELETE — no
 * read-modify-write, which MyISAM cannot make safe.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../billing/fixtures';
import {
  ENCOUNTER_DOC_MODULE_TYPE,
  linkReportToEncounter,
  listLinkedReportIds,
  unlinkReport,
} from '@/repositories/wp/encounter-documents.repo';

const BASE = 8_800_000;
const END = BASE + 100_000;

const ENCOUNTER = BASE + 1;
const OTHER_ENCOUNTER = BASE + 2;
const REPORT_A = BASE + 10;
const REPORT_B = BASE + 11;
const REPORT_C = BASE + 12;

async function wipe() {
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_custom_fields_data WHERE module_id >= ? AND module_id < ?`, BASE, END,
  );
}

beforeAll(async () => { assertTestDb(); await wipe(); });
beforeEach(async () => { await wipe(); });
afterAll(async () => { await wipe(); await prisma.$disconnect(); });

describe('encounter document links', () => {
  it('links a report and reads it back', async () => {
    await linkReportToEncounter(ENCOUNTER, REPORT_A);
    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([REPORT_A]);
  });

  it('writes a row KiviCare cannot see: namespaced module_type and NULL field_id', async () => {
    await linkReportToEncounter(ENCOUNTER, REPORT_A);

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT module_type, module_id, fields_data, field_id
         FROM wp_kc_custom_fields_data WHERE module_id = ?`, ENCOUNTER,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].module_type).toBe(ENCOUNTER_DOC_MODULE_TYPE);
    expect(rows[0].module_type).toBe('praktiqu_report_encounter');
    expect(rows[0].field_id).toBeNull();
    expect(Number(JSON.parse(rows[0].fields_data))).toBe(REPORT_A);
  });

  it('keeps each encounter’s links separate', async () => {
    await linkReportToEncounter(ENCOUNTER, REPORT_A);
    await linkReportToEncounter(OTHER_ENCOUNTER, REPORT_B);

    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([REPORT_A]);
    expect(await listLinkedReportIds(OTHER_ENCOUNTER)).toEqual([REPORT_B]);
  });

  it('returns ids in insertion order', async () => {
    await linkReportToEncounter(ENCOUNTER, REPORT_C);
    await linkReportToEncounter(ENCOUNTER, REPORT_A);
    await linkReportToEncounter(ENCOUNTER, REPORT_B);

    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([REPORT_C, REPORT_A, REPORT_B]);
  });

  it('is idempotent — linking twice does not duplicate the row', async () => {
    await linkReportToEncounter(ENCOUNTER, REPORT_A);
    await linkReportToEncounter(ENCOUNTER, REPORT_A);

    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([REPORT_A]);
  });

  it('unlinks by report id and reports how many rows went', async () => {
    await linkReportToEncounter(ENCOUNTER, REPORT_A);
    await linkReportToEncounter(ENCOUNTER, REPORT_B);

    expect(await unlinkReport(REPORT_A)).toBe(1);
    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([REPORT_B]);
  });

  it('unlinking a report that was never linked is a no-op, not an error', async () => {
    expect(await unlinkReport(REPORT_C)).toBe(0);
  });

  it('tolerates duplicate rows written by an older build', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_custom_fields_data (module_type, module_id, fields_data, field_id, created_at)
       VALUES (?, ?, ?, NULL, NOW()), (?, ?, ?, NULL, NOW())`,
      ENCOUNTER_DOC_MODULE_TYPE, ENCOUNTER, JSON.stringify(REPORT_A),
      ENCOUNTER_DOC_MODULE_TYPE, ENCOUNTER, JSON.stringify(REPORT_A),
    );

    // The read de-duplicates rather than reporting the document twice.
    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([REPORT_A]);
    // And unlinking clears both.
    expect(await unlinkReport(REPORT_A)).toBe(2);
    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([]);
  });

  it('ignores rows belonging to other module types', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_custom_fields_data (module_type, module_id, fields_data, field_id, created_at)
       VALUES ('patient_encounter_module', ?, ?, NULL, NOW())`,
      ENCOUNTER, JSON.stringify(REPORT_C),
    );

    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

```bash
npx vitest run tests/repositories/wp-encounter-documents.repo.test.ts
```

Expected: FAIL — cannot resolve `@/repositories/wp/encounter-documents.repo`.

- [ ] **Step 4: Implement the link half of the repository**

Create `src/repositories/wp/encounter-documents.repo.ts`:

```ts
/**
 * Documents attached to an encounter.
 *
 * Two stores meet here, and they are not symmetric:
 *
 * - `wp_kc_patient_medical_report` is the patient's archive. KiviCare owns the
 *   table; we add rows to it and link them to an encounter through a row of our
 *   own in `wp_kc_custom_fields_data`.
 * - `wp_kc_appointments.appointment_report` is a JSON array of WP attachment ids
 *   written once, at booking. We only ever read it.
 *
 * The link row is namespaced (`praktiqu_report_encounter`) and carries a NULL
 * `field_id`, which together make it invisible to every KiviCare query — the same
 * two constraints the intervention-plan completion state relies on.
 *
 * One row per (encounter, report). Never an array in one row: `wp_kc_*` is MyISAM,
 * so a read-modify-write on a blob has no way to avoid losing a concurrent write.
 */
import { prisma } from '@/lib/db';

export const ENCOUNTER_DOC_MODULE_TYPE = 'praktiqu_report_encounter';

/**
 * Attach a document to an encounter. Idempotent: linking the same pair twice
 * leaves one row, because KiviCare puts no unique index on this table and the
 * duplicate would surface as the same document listed twice.
 */
export async function linkReportToEncounter(
  encounterId: number,
  reportId: number,
): Promise<void> {
  const existing = await prisma.kcCustomFieldData.findFirst({
    where: {
      moduleType: ENCOUNTER_DOC_MODULE_TYPE,
      moduleId: BigInt(encounterId),
      fieldsData: JSON.stringify(reportId),
    },
    select: { id: true },
  });
  if (existing) return;

  await prisma.kcCustomFieldData.create({
    data: {
      moduleType: ENCOUNTER_DOC_MODULE_TYPE,
      moduleId: BigInt(encounterId),
      fieldsData: JSON.stringify(reportId),
      fieldId: null,
      createdAt: new Date(),
    },
  });
}

/** Remove every link pointing at this document. Returns the number of rows removed. */
export async function unlinkReport(reportId: number): Promise<number> {
  const result = await prisma.kcCustomFieldData.deleteMany({
    where: {
      moduleType: ENCOUNTER_DOC_MODULE_TYPE,
      fieldsData: JSON.stringify(reportId),
    },
  });
  return result.count;
}

/** Document ids attached to one encounter, in the order they were attached. */
export async function listLinkedReportIds(encounterId: number): Promise<number[]> {
  const rows = await prisma.kcCustomFieldData.findMany({
    where: {
      moduleType: ENCOUNTER_DOC_MODULE_TYPE,
      moduleId: BigInt(encounterId),
    },
    select: { fieldsData: true },
    orderBy: { id: 'asc' },
  });

  const out: number[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    const id = Number(JSON.parse(row.fieldsData ?? 'null'));
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
npx vitest run tests/repositories/wp-encounter-documents.repo.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 6: Type-check and commit**

```bash
npm run type-check
git add src/repositories/wp/encounter-documents.repo.ts tests/repositories/wp-encounter-documents.repo.test.ts
git commit -m "feat(encounter-documents): link documents to an encounter without a new table"
```

---

### Task 4: Repository — booking attachments and attachment metadata

**Files:**
- Modify: `src/repositories/wp/encounter-documents.repo.ts` (append)
- Modify: `tests/repositories/wp-encounter-documents.repo.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `prisma`
- Produces:
  ```ts
  export interface BookingAttachment {
    mediaId: number;
    filename: string;
    mimeType: string | null;
    /** True when the attachment row is gone from wp_posts — listed, not hidden. */
    missing: boolean;
  }
  export async function listBookingAttachments(appointmentId: number): Promise<BookingAttachment[]>
  export async function attachmentBelongsToAppointment(appointmentId: number, mediaId: number): Promise<boolean>
  ```

- [ ] **Step 1: Write the failing test**

Append to `tests/repositories/wp-encounter-documents.repo.test.ts` (and extend the imports at the top of the file to include `attachmentBelongsToAppointment`, `listBookingAttachments`):

```ts
const APPOINTMENT = BASE + 500;
const APPOINTMENT_EMPTY = BASE + 501;
const APPOINTMENT_NULL = BASE + 502;
const MEDIA_A = BASE + 600;
const MEDIA_B = BASE + 601;
const MEDIA_GONE = BASE + 602;

async function wipeAppointments() {
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_appointments WHERE id >= ? AND id < ?`, BASE, END,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_posts WHERE ID >= ? AND ID < ?`, BASE, END,
  );
}

async function seedAttachment(id: number, file: string, mime: string) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_posts
       (ID, post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt,
        post_status, comment_status, ping_status, post_password, post_name, to_ping, pinged,
        post_modified, post_modified_gmt, post_content_filtered, post_parent, guid, menu_order,
        post_type, post_mime_type, comment_count)
     VALUES (?, 0, NOW(), NOW(), '', ?, '', 'inherit', 'closed', 'closed', '', ?, '', '',
             NOW(), NOW(), '', 0, ?, 0, 'attachment', ?, 0)`,
    id, file, file, `http://test.local/wp-content/uploads/kivicare-reports/${file}`, mime,
  );
}

async function seedAppointment(id: number, report: string | null) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_appointments
       (id, appointment_start_date, appointment_start_time, appointment_end_date,
        appointment_end_time, visit_type, clinic_id, doctor_id, patient_id, description,
        status, created_at, appointment_report)
     VALUES (?, CURDATE(), '09:00:00', CURDATE(), '10:00:00', '1', 1, 1, 1, '', 1, NOW(), ?)`,
    id, report,
  );
}

describe('booking attachments', () => {
  beforeAll(async () => {
    await wipeAppointments();
    await seedAttachment(MEDIA_A, 'hasil-tes.pdf', 'application/pdf');
    await seedAttachment(MEDIA_B, 'form-isian.png', 'image/png');
    await seedAppointment(APPOINTMENT, JSON.stringify([MEDIA_A, MEDIA_GONE, MEDIA_B]));
    await seedAppointment(APPOINTMENT_EMPTY, '[]');
    await seedAppointment(APPOINTMENT_NULL, null);
  });

  afterAll(async () => { await wipeAppointments(); });

  it('resolves each id to a filename and mime type, in stored order', async () => {
    const rows = await listBookingAttachments(APPOINTMENT);

    expect(rows.map((r) => r.mediaId)).toEqual([MEDIA_A, MEDIA_GONE, MEDIA_B]);
    expect(rows[0]).toMatchObject({
      filename: 'hasil-tes.pdf', mimeType: 'application/pdf', missing: false,
    });
    expect(rows[2]).toMatchObject({
      filename: 'form-isian.png', mimeType: 'image/png', missing: false,
    });
  });

  it('lists a deleted attachment as missing instead of dropping or throwing', async () => {
    const rows = await listBookingAttachments(APPOINTMENT);
    const gone = rows.find((r) => r.mediaId === MEDIA_GONE);

    expect(gone).toBeDefined();
    expect(gone!.missing).toBe(true);
    expect(gone!.mimeType).toBeNull();
  });

  it('returns nothing for an empty array, a NULL column, or an unknown appointment', async () => {
    expect(await listBookingAttachments(APPOINTMENT_EMPTY)).toEqual([]);
    expect(await listBookingAttachments(APPOINTMENT_NULL)).toEqual([]);
    expect(await listBookingAttachments(BASE + 999)).toEqual([]);
  });

  it('survives a column holding something that is not a JSON array', async () => {
    const id = BASE + 503;
    await seedAppointment(id, 'not json at all');
    expect(await listBookingAttachments(id)).toEqual([]);
  });

  it('confirms membership only for ids actually in that appointment', async () => {
    expect(await attachmentBelongsToAppointment(APPOINTMENT, MEDIA_A)).toBe(true);
    expect(await attachmentBelongsToAppointment(APPOINTMENT, MEDIA_B)).toBe(true);
    // The guard that stops a valid session being used to read someone else's file.
    expect(await attachmentBelongsToAppointment(APPOINTMENT_EMPTY, MEDIA_A)).toBe(false);
    expect(await attachmentBelongsToAppointment(APPOINTMENT, BASE + 777)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run tests/repositories/wp-encounter-documents.repo.test.ts
```

Expected: FAIL — `listBookingAttachments is not a function`.

- [ ] **Step 3: Implement the booking-attachment half**

Append to `src/repositories/wp/encounter-documents.repo.ts`:

```ts
/* ------------------------------------------------------------------ */
/* Booking attachments — wp_kc_appointments.appointment_report         */
/* ------------------------------------------------------------------ */

export interface BookingAttachment {
  mediaId: number;
  filename: string;
  mimeType: string | null;
  /** True when the attachment row is gone from wp_posts — listed, not hidden. */
  missing: boolean;
}

/**
 * Parse the JSON array KiviCare stores in `appointment_report`.
 *
 * The column is a longtext written by a PHP `json_encode` of whatever the booking
 * form sent, so it may hold `null`, `''`, a non-array, or ids as strings. Anything
 * that is not a finite number is dropped; a malformed column yields an empty list
 * rather than an exception, because one bad row must not break a clinician's screen.
 */
function parseReportIds(raw: string | null): number[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const entry of parsed) {
    const id = Number(entry);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

type AttachmentRow = { ID: bigint; post_title: string | null; post_mime_type: string | null; attached_file: string | null };

/** Filename, preferring the real file on disk over the editable post title. */
function attachmentFilename(row: AttachmentRow, mediaId: number): string {
  const file = row.attached_file ?? '';
  if (file !== '') {
    const slash = file.lastIndexOf('/');
    return slash === -1 ? file : file.slice(slash + 1);
  }
  const title = row.post_title ?? '';
  return title !== '' ? title : `document-${mediaId}`;
}

async function loadAttachments(ids: number[]): Promise<Map<number, AttachmentRow>> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await prisma.$queryRawUnsafe<AttachmentRow[]>(
    `SELECT p.ID, p.post_title, p.post_mime_type, pm.meta_value AS attached_file
       FROM wp_posts p
       LEFT JOIN wp_postmeta pm ON pm.post_id = p.ID AND pm.meta_key = '_wp_attached_file'
      WHERE p.post_type = 'attachment' AND p.ID IN (${placeholders})`,
    ...ids,
  );
  return new Map(rows.map((r) => [Number(r.ID), r]));
}

/**
 * The files that arrived with a booking, in the order KiviCare stored them.
 *
 * An id whose attachment has since been deleted is returned with `missing: true`
 * rather than skipped: the clinician should see that something was attached and is
 * now gone, instead of a list that quietly disagrees with what the client sent.
 */
export async function listBookingAttachments(appointmentId: number): Promise<BookingAttachment[]> {
  const appointment = await prisma.kcAppointment.findUnique({
    where: { id: BigInt(appointmentId) },
    select: { appointmentReport: true },
  });
  if (!appointment) return [];

  const ids = parseReportIds(appointment.appointmentReport);
  if (ids.length === 0) return [];

  const found = await loadAttachments(ids);

  return ids.map((mediaId) => {
    const row = found.get(mediaId);
    if (!row) {
      return { mediaId, filename: `document-${mediaId}`, mimeType: null, missing: true };
    }
    return {
      mediaId,
      filename: attachmentFilename(row, mediaId),
      mimeType: row.post_mime_type ?? null,
      missing: false,
    };
  });
}

/**
 * The authorisation guard for streaming a booking attachment.
 *
 * A media id has no owner of its own, so it is only ever safe to serve one after
 * proving it belongs to an appointment the caller may already read.
 */
export async function attachmentBelongsToAppointment(
  appointmentId: number,
  mediaId: number,
): Promise<boolean> {
  const appointment = await prisma.kcAppointment.findUnique({
    where: { id: BigInt(appointmentId) },
    select: { appointmentReport: true },
  });
  if (!appointment) return false;
  return parseReportIds(appointment.appointmentReport).includes(mediaId);
}

```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run tests/repositories/wp-encounter-documents.repo.test.ts
```

Expected: PASS, 14 tests.

- [ ] **Step 5: Type-check and commit**

```bash
npm run type-check
git add src/repositories/wp/encounter-documents.repo.ts tests/repositories/wp-encounter-documents.repo.test.ts
git commit -m "feat(encounter-documents): read booking attachments, tolerating deleted media"
```

---

### Task 5: Service — assemble the two sections

**Files:**
- Create: `src/services/encounter-documents/service.ts`
- Test: `tests/services/encounter-documents.service.test.ts`

**Interfaces:**
- Consumes: `listLinkedReportIds`, `listBookingAttachments` (Task 3, 4); `findEncounterById` from `@/repositories/wp/clinical-records.repo`; `listMedReports` from `@/services/billing/patient-medical-report.service`; `KcActor`, `KcError`
- Produces:
  ```ts
  export type DocumentSource = 'booking' | 'report';
  export interface EncounterDocument {
    id: number;              // report id, or media id when source === 'booking'
    source: DocumentSource;
    name: string;
    filename: string;
    mimeType: string | null;
    date: string | null;     // YYYY-MM-DD
    contentPath: string;
    canManage: boolean;
    missing: boolean;
  }
  export interface EncounterDocuments {
    sessionDocuments: EncounterDocument[];
    patientDocuments: EncounterDocument[];
    pagination: { page: number; perPage: number; total: number };
  }
  export async function listEncounterDocuments(
    encounterId: number,
    kc: KcActor,
    opts: { page: number; perPage: number },
  ): Promise<EncounterDocuments>
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/services/encounter-documents.service.test.ts`:

```ts
/**
 * The service owns three decisions the repositories deliberately do not:
 * which section a document lands in, whether the caller may manage it, and what
 * `contentPath` the front-end should call. Everything below the service is mocked
 * so those decisions are tested on their own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/repositories/wp/encounter-documents.repo', () => ({
  ENCOUNTER_DOC_MODULE_TYPE: 'praktiqu_report_encounter',
  listLinkedReportIds: vi.fn(),
  listBookingAttachments: vi.fn(),
  linkReportToEncounter: vi.fn(),
  unlinkReport: vi.fn(),
}));
vi.mock('@/repositories/wp/clinical-records.repo', () => ({
  findEncounterById: vi.fn(),
}));
vi.mock('@/services/billing/patient-medical-report.service', () => ({
  listMedReports: vi.fn(),
}));

import { listEncounterDocuments } from '@/services/encounter-documents/service';
import { listBookingAttachments, listLinkedReportIds } from '@/repositories/wp/encounter-documents.repo';
import { findEncounterById } from '@/repositories/wp/clinical-records.repo';
import { listMedReports } from '@/services/billing/patient-medical-report.service';

const ENCOUNTER = { id: 55, clinicId: 1, doctorId: 7, patientId: 9, appointmentId: 77, description: null, status: 1, addedBy: 7, encounterDate: null, createdAt: null };

const PROFESSIONAL: any = { actor: { role: 'PROFESSIONAL' }, wpUserId: 7n, clinicId: 1n };
const CLIENT: any = { actor: { role: 'CLIENT' }, wpUserId: 9n, clinicId: 1n };

function report(id: number, name: string) {
  return { id, name, patient_id: 9, upload_report: String(1000 + id), date: '2026-08-01', patient_name: 'Klien' };
}

beforeEach(() => {
  vi.mocked(findEncounterById).mockResolvedValue(ENCOUNTER as any);
  vi.mocked(listLinkedReportIds).mockResolvedValue([]);
  vi.mocked(listBookingAttachments).mockResolvedValue([]);
  vi.mocked(listMedReports).mockResolvedValue({ reports: [], pagination: { page: 1, perPage: 20, total: 0 } } as any);
});

describe('listEncounterDocuments', () => {
  it('puts booking attachments in the session section, marked as such', async () => {
    vi.mocked(listBookingAttachments).mockResolvedValue([
      { mediaId: 301, filename: 'hasil-tes.pdf', mimeType: 'application/pdf', missing: false },
    ]);

    const out = await listEncounterDocuments(55, PROFESSIONAL, { page: 1, perPage: 20 });

    expect(out.sessionDocuments).toHaveLength(1);
    expect(out.sessionDocuments[0]).toMatchObject({
      id: 301,
      source: 'booking',
      filename: 'hasil-tes.pdf',
      contentPath: '/api/v1/sessions/77/attachments/301/content',
    });
  });

  it('never offers manage on a booking attachment, even to staff', async () => {
    vi.mocked(listBookingAttachments).mockResolvedValue([
      { mediaId: 301, filename: 'x.pdf', mimeType: 'application/pdf', missing: false },
    ]);

    const out = await listEncounterDocuments(55, PROFESSIONAL, { page: 1, perPage: 20 });

    // We never write appointment_report, so rename/delete could not work.
    expect(out.sessionDocuments[0].canManage).toBe(false);
  });

  it('puts a linked report in the session section and the rest in the archive', async () => {
    vi.mocked(listLinkedReportIds).mockResolvedValue([11]);
    vi.mocked(listMedReports).mockResolvedValue({
      reports: [report(11, 'Resume sesi'), report(12, 'Hasil tes lama')],
      pagination: { page: 1, perPage: 20, total: 2 },
    } as any);

    const out = await listEncounterDocuments(55, PROFESSIONAL, { page: 1, perPage: 20 });

    expect(out.sessionDocuments.map((d) => d.id)).toEqual([11]);
    expect(out.sessionDocuments[0]).toMatchObject({
      source: 'report',
      name: 'Resume sesi',
      contentPath: '/api/v1/patient-medical-reports/11/content',
      canManage: true,
    });
    expect(out.patientDocuments.map((d) => d.id)).toEqual([12]);
  });

  it('denies manage to a CLIENT on every document', async () => {
    vi.mocked(listLinkedReportIds).mockResolvedValue([11]);
    vi.mocked(listMedReports).mockResolvedValue({
      reports: [report(11, 'Resume sesi')],
      pagination: { page: 1, perPage: 20, total: 1 },
    } as any);

    const out = await listEncounterDocuments(55, CLIENT, { page: 1, perPage: 20 });

    expect(out.sessionDocuments[0].canManage).toBe(false);
  });

  it('drops a link that points at a document which no longer exists', async () => {
    vi.mocked(listLinkedReportIds).mockResolvedValue([11, 999]);
    vi.mocked(listMedReports).mockResolvedValue({
      reports: [report(11, 'Resume sesi')],
      pagination: { page: 1, perPage: 20, total: 1 },
    } as any);

    const out = await listEncounterDocuments(55, PROFESSIONAL, { page: 1, perPage: 20 });

    expect(out.sessionDocuments.map((d) => d.id)).toEqual([11]);
    expect(out.patientDocuments).toEqual([]);
  });

  it('returns an empty session section when the encounter has no appointment', async () => {
    vi.mocked(findEncounterById).mockResolvedValue({ ...ENCOUNTER, appointmentId: null } as any);

    const out = await listEncounterDocuments(55, PROFESSIONAL, { page: 1, perPage: 20 });

    expect(listBookingAttachments).not.toHaveBeenCalled();
    expect(out.sessionDocuments).toEqual([]);
  });

  it('throws 404 for an encounter that does not exist', async () => {
    vi.mocked(findEncounterById).mockResolvedValue(null);

    await expect(listEncounterDocuments(55, PROFESSIONAL, { page: 1, perPage: 20 }))
      .rejects.toMatchObject({ httpStatus: 404 });
  });

  it('throws 404 when the encounter belongs to another professional', async () => {
    const otherDoctor: any = { actor: { role: 'PROFESSIONAL' }, wpUserId: 8n, clinicId: 1n };

    await expect(listEncounterDocuments(55, otherDoctor, { page: 1, perPage: 20 }))
      .rejects.toMatchObject({ httpStatus: 404 });
  });

  it('throws 404 when the encounter belongs to another client', async () => {
    const otherClient: any = { actor: { role: 'CLIENT' }, wpUserId: 10n, clinicId: 1n };

    await expect(listEncounterDocuments(55, otherClient, { page: 1, perPage: 20 }))
      .rejects.toMatchObject({ httpStatus: 404 });
  });

  it('passes pagination through to the archive read', async () => {
    await listEncounterDocuments(55, PROFESSIONAL, { page: 3, perPage: 5 });

    expect(listMedReports).toHaveBeenCalledWith(
      expect.objectContaining({ page: 3, perPage: 5, patientId: 9 }),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run tests/services/encounter-documents.service.test.ts
```

Expected: FAIL — cannot resolve `@/services/encounter-documents/service`.

- [ ] **Step 3: Implement the service**

Create `src/services/encounter-documents/service.ts`:

```ts
/**
 * The documents visible from one encounter.
 *
 * Two sections, because the two stores mean different things:
 *
 * - `sessionDocuments` — what belongs to this session: the files that arrived with
 *   the booking, plus documents a clinician linked to this encounter.
 * - `patientDocuments` — the rest of the patient's archive, paginated, because an
 *   archive grows without bound while a session's set does not.
 *
 * Authorisation happens twice on purpose. The encounter itself is scoped here, so a
 * professional cannot browse another doctor's session; the archive read is scoped by
 * `medReportScopeFor` inside `listMedReports`, which is clinic-wide. That asymmetry
 * predates this feature and is documented as D7 in the design — it is inherited
 * deliberately, not overlooked.
 */
import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';
import { medReportScopeFor } from '@/services/billing/med-report-scope';
import { listMedReports } from '@/services/billing/patient-medical-report.service';
import { findEncounterById } from '@/repositories/wp/clinical-records.repo';
import {
  listBookingAttachments,
  listLinkedReportIds,
} from '@/repositories/wp/encounter-documents.repo';
import { assertCan } from '@/services/billing/kc-permissions';

export type DocumentSource = 'booking' | 'report';

export interface EncounterDocument {
  /** Report id for `report`; WP attachment id for `booking`. */
  id: number;
  source: DocumentSource;
  name: string;
  filename: string;
  mimeType: string | null;
  /** `YYYY-MM-DD`, or null when KiviCare stored none. */
  date: string | null;
  contentPath: string;
  canManage: boolean;
  missing: boolean;
}

export interface EncounterDocuments {
  sessionDocuments: EncounterDocument[];
  patientDocuments: EncounterDocument[];
  pagination: { page: number; perPage: number; total: number };
}

/** Row scope for the encounter itself, mirroring `encounterScopeFor`. */
function assertEncounterVisible(
  encounter: { doctorId: number; patientId: number; clinicId: number },
  kc: KcActor,
): void {
  const role = kc.actor.role;
  if (role === 'SUPER_ADMIN') return;
  if (role === 'PROFESSIONAL') {
    if (encounter.doctorId === Number(kc.wpUserId)) return;
    throw new KcError('Encounter not found', 404);
  }
  if (role === 'CLIENT') {
    if (encounter.patientId === Number(kc.wpUserId)) return;
    throw new KcError('Encounter not found', 404);
  }
  if (kc.clinicId !== null && encounter.clinicId === Number(kc.clinicId)) return;
  throw new KcError('Encounter not found', 404);
}

/**
 * Whether this actor may rename or delete documents.
 *
 * Booking attachments are always false regardless: we never write
 * `appointment_report`, so a manage button on one would be a button that cannot work.
 */
function canManageReports(kc: KcActor): boolean {
  try {
    assertCan(kc.actor, 'patient_report_manage');
    return true;
  } catch {
    return false;
  }
}

function toDateString(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export async function listEncounterDocuments(
  encounterId: number,
  kc: KcActor,
  opts: { page: number; perPage: number },
): Promise<EncounterDocuments> {
  const encounter = await findEncounterById(encounterId);
  if (!encounter) throw new KcError('Encounter not found', 404);
  assertEncounterVisible(encounter, kc);

  const manage = canManageReports(kc);

  // 1. Booking attachments — only when the encounter records an appointment.
  const booking = encounter.appointmentId === null
    ? []
    : await listBookingAttachments(encounter.appointmentId);

  const sessionDocuments: EncounterDocument[] = booking.map((b) => ({
    id: b.mediaId,
    source: 'booking' as const,
    name: b.filename,
    filename: b.filename,
    mimeType: b.mimeType,
    date: null,
    contentPath: `/api/v1/sessions/${encounter.appointmentId}/attachments/${b.mediaId}/content`,
    canManage: false,
    missing: b.missing,
  }));

  // 2. The patient's archive, split by whether each row is linked to this encounter.
  const linkedIds = new Set(await listLinkedReportIds(encounterId));
  const archive = await listMedReports(
    { page: opts.page, perPage: opts.perPage, patientId: encounter.patientId },
    medReportScopeFor(kc),
  );

  const patientDocuments: EncounterDocument[] = [];
  for (const r of archive.reports) {
    const doc: EncounterDocument = {
      id: r.id,
      source: 'report',
      name: r.name ?? `document-${r.id}`,
      filename: r.name ?? `document-${r.id}`,
      mimeType: null,
      date: toDateString(r.date),
      contentPath: `/api/v1/patient-medical-reports/${r.id}/content`,
      canManage: manage,
      missing: false,
    };
    if (linkedIds.has(r.id)) sessionDocuments.push(doc);
    else patientDocuments.push(doc);
  }

  return {
    sessionDocuments,
    patientDocuments,
    pagination: {
      page: archive.pagination.page,
      perPage: Number(archive.pagination.perPage),
      total: archive.pagination.total,
    },
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run tests/services/encounter-documents.service.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Type-check and commit**

```bash
npm run type-check
git add src/services/encounter-documents/service.ts tests/services/encounter-documents.service.test.ts
git commit -m "feat(encounter-documents): assemble the session and archive sections"
```

---

### Task 6: `GET /api/v1/encounters/{id}/documents`

**Files:**
- Create: `src/app/api/v1/encounters/[id]/documents/route.ts`
- Test: `tests/billing/encounter-documents-routes.integration.test.ts`

**Interfaces:**
- Consumes: `listEncounterDocuments` (Task 5)
- Produces: `export const GET` on that path, answering the `kcOk` envelope

- [ ] **Step 1: Write the failing test**

Create `tests/billing/encounter-documents-routes.integration.test.ts`:

```ts
/**
 * These assertions are reached before any database access: `assertCan` runs before
 * `resolveKcActor`, so the 401 and 403 cases never touch the database.
 */
import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { GET as documentsGET } from '@/app/api/v1/encounters/[id]/documents/route';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function token(role: string, sub = 'test-admin-9000001') {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(SECRET);
}

function reqWith(jwt: string, url: string, init: RequestInit = {}) {
  return new NextRequest(url, {
    ...init,
    headers: { authorization: `Bearer ${jwt}`, ...(init.headers ?? {}) },
  });
}

describe('GET /encounters/:id/documents', () => {
  it('rejects a request with no token (401)', async () => {
    const res = await documentsGET(
      new NextRequest('http://localhost/api/v1/encounters/1/documents'),
      { params: { id: '1' } } as any,
    );
    expect(res.status).toBe(401);
  });

  it('allows a CLIENT to reach the handler — read access is theirs too', async () => {
    const res = await documentsGET(
      reqWith(await token('CLIENT'), 'http://localhost/api/v1/encounters/1/documents'),
      { params: { id: '1' } } as any,
    );
    // Not 403: a client may read its own documents. Whether this encounter is
    // theirs is a row-scope question the service answers with 404.
    expect(res.status).not.toBe(403);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run tests/billing/encounter-documents-routes.integration.test.ts
```

Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Implement the route**

Create `src/app/api/v1/encounters/[id]/documents/route.ts`:

```ts
/**
 * GET /api/v1/encounters/:id/documents
 *
 * A separate endpoint rather than a field on the session-note DTO (design D5):
 * the note payload has only just settled after E3, and most reads of a note do not
 * want its attachments.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { listEncounterDocuments } from '@/services/encounter-documents/service';

export const dynamic = 'force-dynamic';

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

export const GET = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    assertCan(actor, 'patient_report_read');
    const kc = await resolveKcActor(actor);

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
    const requested = Number(url.searchParams.get('perPage') ?? DEFAULT_PER_PAGE) || DEFAULT_PER_PAGE;
    const perPage = Math.min(MAX_PER_PAGE, Math.max(1, requested));

    const data = await listEncounterDocuments(Number(params.id), kc, { page, perPage });
    return kcOk(data, 'Encounter documents retrieved successfully');
  }),
);
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run tests/billing/encounter-documents-routes.integration.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Type-check and commit**

```bash
npm run type-check
git add "src/app/api/v1/encounters/[id]/documents/route.ts" tests/billing/encounter-documents-routes.integration.test.ts
git commit -m "feat(encounter-documents): GET /encounters/:id/documents"
```

---

### Task 7: Stream a report — `GET /api/v1/patient-medical-reports/{id}/content`

**Files:**
- Create: `src/lib/http/content-disposition.ts`
- Create: `tests/lib/content-disposition.test.ts`
- Create: `src/app/api/v1/patient-medical-reports/[id]/content/route.ts`
- Modify: `tests/billing/encounter-documents-routes.integration.test.ts` (append)

**Interfaces:**
- Consumes: `fetchMedia` (Task 1), `getMedReport`, `medReportScopeFor`
- Produces:
  ```ts
  // src/lib/http/content-disposition.ts
  export function inlineDisposition(filename: string): string
  ```
  and `export const GET` streaming bytes with the headers the design fixes.
  Task 8 imports `inlineDisposition` rather than repeating it.

- [ ] **Step 1: Write the failing test for the header helper**

A filename reaches this header straight from a clinician's keyboard. A quote in it
truncates the header; a non-ASCII character makes it unparseable. Both are worth a
test of their own, and both routes need the same function — so it lives on its own.

Create `tests/lib/content-disposition.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { inlineDisposition } from '@/lib/http/content-disposition';

describe('inlineDisposition', () => {
  it('emits both the ASCII fallback and the UTF-8 form', () => {
    expect(inlineDisposition('resume.pdf'))
      .toBe(`inline; filename="resume.pdf"; filename*=UTF-8''resume.pdf`);
  });

  it('neutralises a quote, which would otherwise truncate the header', () => {
    const out = inlineDisposition('he said "hi".pdf');
    expect(out).toContain('filename="he said _hi_.pdf"');
    expect(out.split('filename="')[1].split('"')[0]).not.toContain('"');
  });

  it('neutralises a backslash', () => {
    expect(inlineDisposition('a\\b.pdf')).toContain('filename="a_b.pdf"');
  });

  it('keeps non-ASCII in the UTF-8 form and replaces it in the fallback', () => {
    const out = inlineDisposition('sesi-ké-3.pdf');
    expect(out).toContain('filename="sesi-k_-3.pdf"');
    expect(out).toContain(`filename*=UTF-8''${encodeURIComponent('sesi-ké-3.pdf')}`);
  });

  it('replaces a newline, which would inject a second header', () => {
    expect(inlineDisposition('a\nb.pdf')).toContain('filename="a_b.pdf"');
  });
});
```

- [ ] **Step 2: Run it, watch it fail, then implement it**

```bash
npx vitest run tests/lib/content-disposition.test.ts
```

Expected: FAIL — module not found. Then create `src/lib/http/content-disposition.ts`:

```ts
/**
 * `Content-Disposition` for a file we are handing back inline.
 *
 * Filenames here come from clinicians and from clients' own uploads, so they carry
 * quotes, backslashes, newlines and Indonesian diacritics. The quoted form is
 * reduced to safe ASCII — a stray quote truncates the header and a newline injects
 * a second one — while `filename*` carries the real name per RFC 5987.
 */
export function inlineDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
```

Re-run: PASS, 5 tests.

- [ ] **Step 3: Write the failing route test**

Append to `tests/billing/encounter-documents-routes.integration.test.ts`:

```ts
import { GET as reportContentGET } from '@/app/api/v1/patient-medical-reports/[id]/content/route';

describe('GET /patient-medical-reports/:id/content', () => {
  it('rejects a request with no token (401)', async () => {
    const res = await reportContentGET(
      new NextRequest('http://localhost/api/v1/patient-medical-reports/1/content'),
      { params: { id: '1' } } as any,
    );
    expect(res.status).toBe(401);
  });

  it('lets a CLIENT through to the row-scope check', async () => {
    const res = await reportContentGET(
      reqWith(await token('CLIENT'), 'http://localhost/api/v1/patient-medical-reports/1/content'),
      { params: { id: '1' } } as any,
    );
    expect(res.status).not.toBe(403);
  });
});
```

- [ ] **Step 4: Run the test and watch it fail**

```bash
npx vitest run tests/billing/encounter-documents-routes.integration.test.ts
```

Expected: FAIL — cannot resolve the content route module.

- [ ] **Step 5: Implement the route**

Create `src/app/api/v1/patient-medical-reports/[id]/content/route.ts`:

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
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { medReportScopeFor } from '@/services/billing/med-report-scope';
import { getMedReport } from '@/services/billing/patient-medical-report.service';
import { fetchMedia } from '@/lib/wp-endpoint';
import { KcError } from '@/lib/kc-response';
import { inlineDisposition } from '@/lib/http/content-disposition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const { actor, params } = ctx as any;
  try {
    assertCan(actor, 'patient_report_read');
    const kc = await resolveKcActor(actor);

    // Scope + existence. Throws 404 when the document is outside the caller's rows.
    const report = await getMedReport(Number(params.id), medReportScopeFor(kc));

    const mediaId = Number.parseInt(String(report.upload_report), 10);
    if (!Number.isFinite(mediaId)) {
      return kcFail('Document has no file', 404);
    }

    const media = await fetchMedia(mediaId);

    const headers = new Headers({
      'Content-Type': media.contentType,
      'Content-Disposition': inlineDisposition(report.name ?? media.filename),
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
    console.error('[report-content] failed', err);
    return kcFail('Could not read the document', 502);
  }
});
```

- [ ] **Step 6: Run the tests and watch them pass**

```bash
npx vitest run tests/lib/content-disposition.test.ts tests/billing/encounter-documents-routes.integration.test.ts
```

Expected: PASS — 5 helper tests, 4 route tests.

- [ ] **Step 7: Type-check and commit**

```bash
npm run type-check
git add src/lib/http/content-disposition.ts tests/lib/content-disposition.test.ts \
        "src/app/api/v1/patient-medical-reports/[id]/content/route.ts" \
        tests/billing/encounter-documents-routes.integration.test.ts
git commit -m "feat(encounter-documents): stream a report's bytes to an authorised caller"
```

---

### Task 8: Stream a booking attachment — `GET /api/v1/sessions/{id}/attachments/{mediaId}/content`

**Files:**
- Create: `src/app/api/v1/sessions/[id]/attachments/[mediaId]/content/route.ts`
- Modify: `tests/billing/encounter-documents-routes.integration.test.ts` (append)

**Interfaces:**
- Consumes: `getSession` from `@/services/session/session.service`, `attachmentBelongsToAppointment` (Task 4), `fetchMedia` (Task 1)
- Produces: `export const GET`

- [ ] **Step 1: Write the failing test**

Append to `tests/billing/encounter-documents-routes.integration.test.ts`:

```ts
import { GET as attachmentGET } from '@/app/api/v1/sessions/[id]/attachments/[mediaId]/content/route';

describe('GET /sessions/:id/attachments/:mediaId/content', () => {
  it('rejects a request with no token (401)', async () => {
    const res = await attachmentGET(
      new NextRequest('http://localhost/api/v1/sessions/1/attachments/2/content'),
      { params: { id: '1', mediaId: '2' } } as any,
    );
    expect(res.status).toBe(401);
  });

  it('refuses a non-numeric media id before any lookup (404)', async () => {
    const res = await attachmentGET(
      reqWith(await token('SUPER_ADMIN'), 'http://localhost/api/v1/sessions/1/attachments/abc/content'),
      { params: { id: '1', mediaId: 'abc' } } as any,
    );
    expect(res.status).toBe(404);
  });
});
```

The ownership guard itself is already covered for real in Task 4
(`attachmentBelongsToAppointment(APPOINTMENT_EMPTY, MEDIA_A)` must be `false`,
against seeded rows). Do **not** add a mocked version of that assertion here — a
test that stubs the guard and then checks the stub proves nothing, and reads as
coverage the route does not have. The route's own end-to-end check against a real
foreign media id is step 4 of the runbook in Task 13.

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run tests/billing/encounter-documents-routes.integration.test.ts
```

Expected: FAIL — cannot resolve the attachments route module.

- [ ] **Step 3: Implement the route**

Create `src/app/api/v1/sessions/[id]/attachments/[mediaId]/content/route.ts`:

```ts
/**
 * GET /api/v1/sessions/:id/attachments/:mediaId/content
 *
 * The files a client sent with the booking, stored as a JSON array of WP attachment
 * ids in `wp_kc_appointments.appointment_report`.
 *
 * Two checks, and both are load-bearing:
 *
 * 1. `getSession` throws 403/404 unless the caller may read this session.
 * 2. The media id must actually appear in this session's `appointment_report`.
 *
 * Without (2) any caller holding one legitimate session could walk the media library
 * by incrementing an integer. The failure is 404, not 403 — a 403 would confirm the
 * id exists.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcFail } from '@/lib/kc-response';
import { getSession, SessionServiceError } from '@/services/session/session.service';
import { attachmentBelongsToAppointment, listBookingAttachments } from '@/repositories/wp/encounter-documents.repo';
import { fetchMedia } from '@/lib/wp-endpoint';
import { inlineDisposition } from '@/lib/http/content-disposition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const { actor, params } = ctx as any;
  try {
    const sessionId = Number(params.id);
    const mediaId = Number(params.mediaId);
    if (!Number.isFinite(sessionId) || !Number.isFinite(mediaId)) {
      return kcFail('Attachment not found', 404);
    }

    // Throws 403/404 when this session is not the caller's to read.
    await getSession(actor, sessionId);

    if (!(await attachmentBelongsToAppointment(sessionId, mediaId))) {
      return kcFail('Attachment not found', 404);
    }

    const attachments = await listBookingAttachments(sessionId);
    const meta = attachments.find((a) => a.mediaId === mediaId);
    if (!meta || meta.missing) {
      return kcFail('Attachment file is no longer available', 404);
    }

    const media = await fetchMedia(mediaId);

    const headers = new Headers({
      'Content-Type': media.contentType,
      'Content-Disposition': inlineDisposition(meta.filename),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    if (media.contentLength !== null) {
      headers.set('Content-Length', String(media.contentLength));
    }

    return new NextResponse(media.body as any, { status: 200, headers });
  } catch (err) {
    if (err instanceof SessionServiceError) {
      return kcFail(err.message, (err as any).httpStatus ?? 403);
    }
    // eslint-disable-next-line no-console
    console.error('[attachment-content] failed', err);
    return kcFail('Could not read the attachment', 502);
  }
});
```

Check `SessionServiceError`'s status property name before committing:

```bash
grep -n -A8 "export class SessionServiceError" src/services/session/session.service.ts
```

If the field is named something other than `httpStatus`, use that name in the `catch` above rather than the `as any` fallback.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npx vitest run tests/billing/encounter-documents-routes.integration.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Type-check and commit**

```bash
npm run type-check
git add "src/app/api/v1/sessions/[id]/attachments/[mediaId]/content/route.ts" \
        tests/billing/encounter-documents-routes.integration.test.ts
git commit -m "feat(encounter-documents): stream a booking attachment, guarded by ownership"
```

---

### Task 9: Upload — `POST /api/v1/encounters/{id}/documents`

**Files:**
- Modify: `src/services/encounter-documents/service.ts` (append `uploadEncounterDocument`)
- Modify: `src/app/api/v1/encounters/[id]/documents/route.ts` (add `POST`)
- Modify: `tests/services/encounter-documents.service.test.ts` (append)
- Modify: `tests/billing/encounter-documents-routes.integration.test.ts` (append)

**Interfaces:**
- Consumes: `validateUpload`, `MAX_UPLOAD_BYTES`, `MAX_UPLOAD_MB` from `@/services/uploads/validate-upload`; `uploadMedia` from `@/lib/wp-endpoint`; `createMedReport`; `linkReportToEncounter`
- Produces:
  ```ts
  export interface UploadDocumentInput { filename: string; bytes: Uint8Array; name: string }
  export async function uploadEncounterDocument(
    encounterId: number, input: UploadDocumentInput, kc: KcActor,
  ): Promise<{ id: number; mediaId: number; linked: boolean }>
  ```

- [ ] **Step 1: Write the failing test**

Append to `tests/services/encounter-documents.service.test.ts`. Extend the mock factories at the top of the file first — add `createMedReport: vi.fn(),` to the `@/services/billing/patient-medical-report.service` factory, and add:

```ts
vi.mock('@/lib/wp-endpoint', () => ({ uploadMedia: vi.fn() }));
```

Then append:

```ts
import { uploadEncounterDocument } from '@/services/encounter-documents/service';
import { createMedReport } from '@/services/billing/patient-medical-report.service';
import { uploadMedia } from '@/lib/wp-endpoint';
import { linkReportToEncounter } from '@/repositories/wp/encounter-documents.repo';

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

describe('uploadEncounterDocument', () => {
  beforeEach(() => {
    vi.mocked(uploadMedia).mockResolvedValue({ mediaId: 4242, url: '', name: 'resume.pdf' } as any);
    vi.mocked(createMedReport).mockResolvedValue({ id: 88 } as any);
    vi.mocked(linkReportToEncounter).mockResolvedValue(undefined as any);
  });

  it('writes media, then the document row, then the link — in that order', async () => {
    const order: string[] = [];
    vi.mocked(uploadMedia).mockImplementation(async () => { order.push('media'); return { mediaId: 4242, url: '', name: 'resume.pdf' } as any; });
    vi.mocked(createMedReport).mockImplementation(async () => { order.push('report'); return { id: 88 } as any; });
    vi.mocked(linkReportToEncounter).mockImplementation(async () => { order.push('link'); });

    const out = await uploadEncounterDocument(
      55, { filename: 'resume.pdf', bytes: PDF_BYTES, name: 'Resume sesi' }, PROFESSIONAL,
    );

    // MyISAM cannot roll back, so the order is the safety mechanism: a failure after
    // the report row still leaves a usable document in the patient archive.
    expect(order).toEqual(['media', 'report', 'link']);
    expect(out).toEqual({ id: 88, mediaId: 4242, linked: true });
  });

  it('always uploads into the protected medical-report folder', async () => {
    await uploadEncounterDocument(55, { filename: 'resume.pdf', bytes: PDF_BYTES, name: 'R' }, PROFESSIONAL);

    // kivicare-uploads is world-readable; clinical documents must never land there.
    expect(uploadMedia).toHaveBeenCalledWith(expect.objectContaining({ context: 'medical-report' }));
  });

  it('refuses a file whose bytes are not an allowed type', async () => {
    await expect(uploadEncounterDocument(
      55, { filename: 'notes.pdf', bytes: new TextEncoder().encode('hello'), name: 'R' }, PROFESSIONAL,
    )).rejects.toMatchObject({ httpStatus: 422 });

    expect(uploadMedia).not.toHaveBeenCalled();
  });

  it('refuses a file whose extension disagrees with its bytes', async () => {
    await expect(uploadEncounterDocument(
      55, { filename: 'resume.png', bytes: PDF_BYTES, name: 'R' }, PROFESSIONAL,
    )).rejects.toMatchObject({ httpStatus: 422 });
  });

  it('refuses a CLIENT (403) before touching the media library', async () => {
    await expect(uploadEncounterDocument(
      55, { filename: 'resume.pdf', bytes: PDF_BYTES, name: 'R' }, CLIENT,
    )).rejects.toMatchObject({ httpStatus: 403 });

    expect(uploadMedia).not.toHaveBeenCalled();
  });

  it('reports linked:false rather than failing when only the link write fails', async () => {
    vi.mocked(linkReportToEncounter).mockRejectedValue(new Error('MyISAM said no'));

    const out = await uploadEncounterDocument(
      55, { filename: 'resume.pdf', bytes: PDF_BYTES, name: 'R' }, PROFESSIONAL,
    );

    // The document exists and is reachable from the patient archive. Failing the
    // whole request would strand a file the caller cannot see or retry cleanly.
    expect(out).toEqual({ id: 88, mediaId: 4242, linked: false });
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run tests/services/encounter-documents.service.test.ts
```

Expected: FAIL — `uploadEncounterDocument is not a function`.

- [ ] **Step 3: Implement the service function**

Append to `src/services/encounter-documents/service.ts` (and extend its imports):

```ts
import { validateUpload } from '@/services/uploads/validate-upload';
import { uploadMedia } from '@/lib/wp-endpoint';
import { createMedReport } from '@/services/billing/patient-medical-report.service';
import { linkReportToEncounter } from '@/repositories/wp/encounter-documents.repo';

export interface UploadDocumentInput {
  filename: string;
  bytes: Uint8Array;
  name: string;
}

/**
 * Attach a new document to an encounter.
 *
 * Write order is the only safety mechanism available — `wp_kc_*` is MyISAM, so there
 * is no transaction to roll back:
 *
 *   1. media   — an orphan attachment costs disk and nothing else
 *   2. report  — from here the document is usable from the patient archive
 *   3. link    — failing here leaves a coherent state, so it is reported, not thrown
 */
export async function uploadEncounterDocument(
  encounterId: number,
  input: UploadDocumentInput,
  kc: KcActor,
): Promise<{ id: number; mediaId: number; linked: boolean }> {
  assertCan(kc.actor, 'patient_report_manage');

  const encounter = await findEncounterById(encounterId);
  if (!encounter) throw new KcError('Encounter not found', 404);
  assertEncounterVisible(encounter, kc);

  const validation = validateUpload({ name: input.filename, bytes: input.bytes });
  // `=== false` rather than `!validation.ok`: this project runs with
  // strictNullChecks off, where the negation does not narrow the union.
  if (validation.ok === false) {
    throw new KcError(validation.message, 422);
  }

  const uploaded = await uploadMedia({
    filename: input.filename,
    contentType: validation.mime,
    bytes: input.bytes,
    context: 'medical-report',
  });

  const created = await createMedReport(
    {
      patientId: encounter.patientId,
      name: input.name.trim() === '' ? input.filename : input.name.trim(),
      uploadReport: String(uploaded.mediaId),
    },
    kc,
  );

  try {
    await linkReportToEncounter(encounterId, created.id);
  } catch (err) {
    // The document is already in the archive; only its tie to this encounter is
    // missing. Say so instead of failing a request that mostly succeeded.
    // eslint-disable-next-line no-console
    console.error('[encounter-documents] link failed', { encounterId, reportId: created.id, err });
    return { id: created.id, mediaId: uploaded.mediaId, linked: false };
  }

  return { id: created.id, mediaId: uploaded.mediaId, linked: true };
}
```

- [ ] **Step 4: Run the service test and watch it pass**

```bash
npx vitest run tests/services/encounter-documents.service.test.ts
```

Expected: PASS, 16 tests.

- [ ] **Step 5: Add the route handler**

Append to `src/app/api/v1/encounters/[id]/documents/route.ts`:

```ts
import { kcFail } from '@/lib/kc-response';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from '@/services/uploads/validate-upload';
import { uploadEncounterDocument } from '@/services/encounter-documents/service';

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    assertCan(actor, 'patient_report_manage');
    const kc = await resolveKcActor(actor);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return kcFail('Expected multipart/form-data', 400);
    }

    const part = form.get('file');
    if (typeof part === 'string' || part === null) {
      return kcFail('No file provided', 400);
    }
    // Check the declared size before buffering, so an oversized upload never
    // reaches the heap.
    if (part.size > MAX_UPLOAD_BYTES) {
      return kcFail(`File exceeds the ${MAX_UPLOAD_MB} MB limit`, 422);
    }

    const bytes = new Uint8Array(await part.arrayBuffer());
    const name = String(form.get('name') ?? '').trim();

    const result = await uploadEncounterDocument(
      Number(params.id),
      { filename: part.name, bytes, name },
      kc,
    );

    return kcOk(result, result.linked
      ? 'Document uploaded successfully'
      : 'Document uploaded, but could not be linked to this encounter');
  }),
);
```

Also add `export const runtime = 'nodejs';` next to the existing `export const dynamic` line — multipart parsing needs the Node runtime.

- [ ] **Step 6: Add the route auth test**

Append to `tests/billing/encounter-documents-routes.integration.test.ts`:

```ts
import { POST as documentsPOST } from '@/app/api/v1/encounters/[id]/documents/route';

describe('POST /encounters/:id/documents', () => {
  it('rejects a request with no token (401)', async () => {
    const res = await documentsPOST(
      new NextRequest('http://localhost/api/v1/encounters/1/documents', { method: 'POST' }),
      { params: { id: '1' } } as any,
    );
    expect(res.status).toBe(401);
  });

  it('denies a CLIENT (403) — upload is staff-only', async () => {
    const res = await documentsPOST(
      reqWith(await token('CLIENT'), 'http://localhost/api/v1/encounters/1/documents', { method: 'POST' }),
      { params: { id: '1' } } as any,
    );
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 7: Run both suites and commit**

```bash
npx vitest run tests/billing/encounter-documents-routes.integration.test.ts tests/services/encounter-documents.service.test.ts
npm run type-check
git add src/services/encounter-documents/service.ts "src/app/api/v1/encounters/[id]/documents/route.ts" tests/
git commit -m "feat(encounter-documents): upload a document from an encounter"
```

Expected before committing: 8 route tests and 16 service tests, all passing.

---

### Task 10: Rename — `PATCH /api/v1/patient-medical-reports/{id}`

**Files:**
- Modify: `src/services/billing/patient-medical-report.service.ts`
- Modify: `src/app/api/v1/patient-medical-reports/[id]/route.ts`
- Test: `tests/billing/patient-medical-report-rename.test.ts` (create)

**Interfaces:**
- Consumes: `getMedReport`, `MedReportScope`
- Produces: `export async function renameMedReport(id: number, name: string, scope: MedReportScope | null): Promise<{ id: number; name: string }>`

- [ ] **Step 1: Write the failing test**

Create `tests/billing/patient-medical-report-rename.test.ts`:

```ts
/**
 * Rename touches the `name` column and nothing else. The file, the media id and the
 * encounter link are all untouched — a typo in a label is not a reason to disturb a
 * clinical document.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from './fixtures';
import { renameMedReport } from '@/services/billing/patient-medical-report.service';

const BASE = 8_900_000;
const END = BASE + 1_000;
const REPORT = BASE + 1;
const PATIENT = BASE + 50;

async function wipe() {
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_patient_medical_report WHERE id >= ? AND id < ?`, BASE, END,
  );
}

beforeEach(async () => {
  assertTestDb();
  await wipe();
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_patient_medical_report (id, name, patient_id, upload_report, date)
     VALUES (?, ?, ?, ?, NOW())`,
    REPORT, 'Salah ketik', PATIENT, '4242',
  );
});

afterAll(async () => { await wipe(); await prisma.$disconnect(); });

describe('renameMedReport', () => {
  it('changes the name and leaves the file alone', async () => {
    const out = await renameMedReport(REPORT, 'Resume sesi konseling', null);

    expect(out).toEqual({ id: REPORT, name: 'Resume sesi konseling' });

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT name, upload_report FROM wp_kc_patient_medical_report WHERE id = ?`, REPORT,
    );
    expect(rows[0].name).toBe('Resume sesi konseling');
    expect(rows[0].upload_report).toBe('4242');
  });

  it('trims the name', async () => {
    const out = await renameMedReport(REPORT, '  Resume  ', null);
    expect(out.name).toBe('Resume');
  });

  it('rejects an empty name rather than storing a blank label', async () => {
    await expect(renameMedReport(REPORT, '   ', null)).rejects.toMatchObject({ httpStatus: 400 });
  });

  it('404s for a document outside the caller’s scope', async () => {
    await expect(renameMedReport(REPORT, 'X', { patientId: BigInt(PATIENT + 1) }))
      .rejects.toMatchObject({ httpStatus: 404 });
  });

  it('404s for a document that does not exist', async () => {
    await expect(renameMedReport(BASE + 999, 'X', null)).rejects.toMatchObject({ httpStatus: 404 });
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run tests/billing/patient-medical-report-rename.test.ts
```

Expected: FAIL — `renameMedReport is not a function`.

- [ ] **Step 3: Implement the service function**

Insert into `src/services/billing/patient-medical-report.service.ts`, directly after `createMedReport`:

```ts
/**
 * Rename a document. Only `name` changes — the media id, the file and any encounter
 * link stay exactly as they are.
 */
export async function renameMedReport(
  id: number,
  name: string,
  scope: MedReportScope | null,
): Promise<{ id: number; name: string }> {
  const trimmed = name.trim();
  if (trimmed === '') throw new KcError('Name is required', 400);

  await getMedReport(id, scope); // scope + existence (404)

  await prisma.kcPatientMedicalReport.update({
    where: { id: BigInt(id) },
    data: { name: trimmed },
  });

  return { id, name: trimmed };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run tests/billing/patient-medical-report-rename.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Add the route**

Append to `src/app/api/v1/patient-medical-reports/[id]/route.ts`:

```ts
import { kcFail } from '@/lib/kc-response';
import { renameMedReport } from '@/services/billing/patient-medical-report.service';

export const PATCH = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'patient_report_manage');
  const kc = await resolveKcActor(actor);

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name : '';
  if (name.trim() === '') return kcFail('Name is required', 400);

  const data = await renameMedReport(Number(params.id), name, medReportScopeFor(kc));
  return kcOk(data, 'Medical report renamed successfully');
}));
```

- [ ] **Step 6: Type-check and commit**

```bash
npm run type-check
npx vitest run tests/billing/patient-medical-report-rename.test.ts
git add src/services/billing/patient-medical-report.service.ts "src/app/api/v1/patient-medical-reports/[id]/route.ts" tests/billing/patient-medical-report-rename.test.ts
git commit -m "feat(patient-medical-reports): PATCH renames a document"
```

---

### Task 11: Repairs — unlink on delete, an honest `/file`, and no more `/preview`

**Files:**
- Modify: `src/services/billing/patient-medical-report.service.ts` (`deleteMedReport`, `bulkDeleteMedReports`, `resolveReportFile`)
- Modify: `src/app/api/v1/patient-medical-reports/[id]/file/route.ts`
- Delete: `src/app/api/v1/patient-medical-reports/[id]/preview/route.ts`
- Test: `tests/billing/patient-medical-report-delete-unlink.test.ts` (create)

**Interfaces:**
- Consumes: `unlinkReport` (Task 3)
- Produces: `resolveReportFile` now returns `{ reportId, name, mediaId, contentPath }` — note `fileUrl` is **gone**

- [ ] **Step 1: Write the failing test**

Create `tests/billing/patient-medical-report-delete-unlink.test.ts`:

```ts
/**
 * Deleting a document must take its encounter link with it. A link left behind
 * points at a row that no longer exists, and every encounter listing then has to
 * work around it forever.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from './fixtures';
import { deleteMedReport, resolveReportFile } from '@/services/billing/patient-medical-report.service';
import { ENCOUNTER_DOC_MODULE_TYPE, listLinkedReportIds, linkReportToEncounter } from '@/repositories/wp/encounter-documents.repo';

const BASE = 9_000_000;
const END = BASE + 1_000;
const REPORT = BASE + 1;
const PATIENT = BASE + 50;
const ENCOUNTER = BASE + 90;

async function wipe() {
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_patient_medical_report WHERE id >= ? AND id < ?`, BASE, END,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_custom_fields_data WHERE module_type = ? AND module_id >= ? AND module_id < ?`,
    ENCOUNTER_DOC_MODULE_TYPE, BASE, END,
  );
}

beforeEach(async () => {
  assertTestDb();
  await wipe();
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_patient_medical_report (id, name, patient_id, upload_report, date)
     VALUES (?, ?, ?, ?, NOW())`,
    REPORT, 'Resume sesi', PATIENT, '4242',
  );
  await linkReportToEncounter(ENCOUNTER, REPORT);
});

afterAll(async () => { await wipe(); await prisma.$disconnect(); });

describe('deleteMedReport', () => {
  it('removes the encounter link along with the document', async () => {
    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([REPORT]);

    await deleteMedReport(REPORT, null);

    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([]);
  });
});

describe('resolveReportFile', () => {
  it('returns a path the front-end can actually call, not a WordPress URL', async () => {
    const out = await resolveReportFile(REPORT, null);

    expect(out).toEqual({
      reportId: REPORT,
      name: 'Resume sesi',
      mediaId: '4242',
      contentPath: `/api/v1/patient-medical-reports/${REPORT}/content`,
    });
    // The old `fileUrl` pointed into uploads/kivicare-reports, which is Deny from all.
    expect(out).not.toHaveProperty('fileUrl');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run tests/billing/patient-medical-report-delete-unlink.test.ts
```

Expected: FAIL — the link survives the delete, and `resolveReportFile` still returns `fileUrl`.

- [ ] **Step 3: Make delete unlink**

In `src/services/billing/patient-medical-report.service.ts`, add the import at the top:

```ts
import { unlinkReport } from '@/repositories/wp/encounter-documents.repo';
```

Replace `deleteMedReport` with:

```ts
export async function deleteMedReport(id: number, scope: MedReportScope | null): Promise<void> {
  await getMedReport(id, scope); // scope + existence (404)
  // Link first: a link pointing at a deleted document would have to be worked
  // around by every encounter listing from here on.
  await unlinkReport(id);
  await prisma.kcPatientMedicalReport.delete({ where: { id: BigInt(id) } });
}
```

And in `bulkDeleteMedReports`, insert the unlink loop immediately before the `deleteMany`:

```ts
  for (const okId of okIds) {
    await unlinkReport(Number(okId));
  }
  const r = await prisma.kcPatientMedicalReport.deleteMany({ where: { id: { in: okIds } } });
```

- [ ] **Step 4: Make `resolveReportFile` honest**

Replace the whole of `resolveReportFile` with:

```ts
/**
 * Where to fetch this document's bytes.
 *
 * This used to return the WordPress `guid`. That URL can never be opened: the
 * `uploads/kivicare-reports` directory carries an `.htaccess` of `Deny from all`,
 * written by KiviCare's own media migration. Handing the front-end a link that is
 * guaranteed to 403 is worse than returning no link at all, so this now points at
 * the authenticated streaming route.
 */
export async function resolveReportFile(id: number, scope: MedReportScope | null) {
  const report = await getMedReport(id, scope);
  return {
    reportId: report.id,
    name: report.name,
    mediaId: report.upload_report,
    contentPath: `/api/v1/patient-medical-reports/${report.id}/content`,
  };
}
```

- [ ] **Step 5: Delete the `/preview` stub**

```bash
rm -r "src/app/api/v1/patient-medical-reports/[id]/preview"
```

`/content` answers the pop-up requirement that stub was holding a place for.

- [ ] **Step 6: Run the tests and watch them pass**

```bash
npx vitest run tests/billing/patient-medical-report-delete-unlink.test.ts
npm run test
```

Expected: the new file passes, 2 tests; the full suite has no new failures. If an existing test asserted on `fileUrl`, update it to `contentPath` — that assertion was describing a link that never worked.

- [ ] **Step 7: Type-check and commit**

```bash
npm run type-check
git add -A src/services/billing/patient-medical-report.service.ts "src/app/api/v1/patient-medical-reports" tests/billing/patient-medical-report-delete-unlink.test.ts
git commit -m "fix(patient-medical-reports): unlink on delete, and stop returning a dead file URL"
```

---

### Task 12: Contract — OpenAPI, Postman, front-end handover

**Files:**
- Modify: `docs/api/openapi.yaml`
- Modify: `docs/handover/2026-08-02-frontend-checklist.md`
- Regenerate: `docs/api/postman-collection.json`

**Interfaces:**
- Consumes: every route from Tasks 6–11
- Produces: documentation only, no runtime change

These paths are not under `OWNED_PREFIXES` in `scripts/generate-openapi.ts` (`/api/v1/clients`, `/api/v1/session-notes`, `/api/v1/intervention-plans`), so they are hand-written entries. Do not add them to the generator: it derives schemas from Zod, and these routes validate multipart and stream bytes, neither of which the generator models.

- [ ] **Step 1: Add the paths to `docs/api/openapi.yaml`**

Add under `paths:`, alongside the existing `patient-medical-reports` entries:

```yaml
  /api/v1/encounters/{id}/documents:
    get:
      tags: [Encounters]
      summary: Documents visible from an encounter
      description: >
        Two sections. `sessionDocuments` holds the files that arrived with the
        booking plus documents linked to this encounter. `patientDocuments` holds
        the rest of the patient's archive and is paginated.
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer }, example: 55 }
        - { name: page, in: query, required: false, schema: { type: integer, default: 1 } }
        - { name: perPage, in: query, required: false, schema: { type: integer, default: 20, maximum: 100 } }
      responses:
        '200':
          description: Documents retrieved
          content:
            application/json:
              schema:
                type: object
                properties:
                  status: { type: boolean }
                  message: { type: string }
                  data:
                    type: object
                    properties:
                      sessionDocuments:
                        type: array
                        items: { $ref: '#/components/schemas/EncounterDocument' }
                      patientDocuments:
                        type: array
                        items: { $ref: '#/components/schemas/EncounterDocument' }
                      pagination:
                        type: object
                        properties:
                          page: { type: integer }
                          perPage: { type: integer }
                          total: { type: integer }
    post:
      tags: [Encounters]
      summary: Upload a document and attach it to this encounter
      description: Staff only. jpg, jpeg, png, webp, gif or pdf, up to 10 MB.
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer }, example: 55 }
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [file]
              properties:
                file: { type: string, format: binary }
                name: { type: string, example: Resume sesi konseling }
      responses:
        '200':
          description: >
            Uploaded. `linked: false` means the document is in the patient archive
            but its tie to this encounter could not be written.
        '403': { description: Not permitted — upload is staff only }
        '422': { description: File rejected by type or size validation }

  /api/v1/patient-medical-reports/{id}/content:
    get:
      tags: [Patient Medical Reports]
      summary: Stream a document's bytes
      description: >
        Requires a Bearer token, so it cannot be used directly as an `<img>` or
        `<iframe>` src. Fetch it with the token and wrap the response in a blob URL.
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer }, example: 12 }
      responses:
        '200':
          description: The file
          content:
            application/octet-stream:
              schema: { type: string, format: binary }
        '404': { description: Not found, out of scope, or the file is gone }

  /api/v1/sessions/{id}/attachments/{mediaId}/content:
    get:
      tags: [Sessions]
      summary: Stream a file that arrived with the booking
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer }, example: 77 }
        - { name: mediaId, in: path, required: true, schema: { type: integer }, example: 301 }
      responses:
        '200':
          description: The file
          content:
            application/octet-stream:
              schema: { type: string, format: binary }
        '404': { description: Not this session's attachment, or the file is gone }
```

And add to `components.schemas`:

```yaml
    EncounterDocument:
      type: object
      properties:
        id:
          type: integer
          description: Report id, or the WP attachment id when source is `booking`.
        source: { type: string, enum: [booking, report] }
        name: { type: string }
        filename: { type: string }
        mimeType: { type: string, nullable: true }
        date: { type: string, nullable: true, example: '2026-08-24' }
        contentPath: { type: string, example: /api/v1/patient-medical-reports/12/content }
        canManage:
          type: boolean
          description: >
            False for every `booking` document — `appointment_report` is never
            written by this API, so rename and delete do not apply to them.
        missing:
          type: boolean
          description: The attachment row is gone from WordPress; the entry is kept so the loss is visible.
```

Also add the `PATCH` operation to the existing `/api/v1/patient-medical-reports/{id}` entry, and delete the `/preview` entry if one is present.

- [ ] **Step 2: Verify the spec still parses and the generated paths are unchanged**

```bash
npm run openapi:check
```

Expected: PASS. It compares only the owned prefixes, so hand-written additions must not disturb it. A failure here means an edit landed inside a generated block — move it out.

- [ ] **Step 3: Regenerate the Postman collection**

```bash
npm run postman
```

Expected: `docs/api/postman-collection.json` rewritten, exit code 0.

- [ ] **Step 4: Write the front-end section**

Append to `docs/handover/2026-08-02-frontend-checklist.md`:

```markdown
---

## Step 9 — Documents on the encounter screen (added 2026-08-24)

`GET /api/v1/encounters/{id}/documents` returns two lists. Render
`sessionDocuments` under "Dokumen sesi ini" and `patientDocuments` under "Arsip
pasien". Each item's `source` tells you where it came from: `booking` is what the
client sent when booking, `report` is what a clinician uploaded.

**Opening a document needs a fetch, not an `<img src>`.** `contentPath` requires
the Bearer header, which a browser will not attach to a plain `src`:

```js
const res  = await fetch(doc.contentPath, { headers: { Authorization: `Bearer ${token}` } });
const blob = await res.blob();
const url  = URL.createObjectURL(blob);   // use as <iframe src> or <img src>
// URL.revokeObjectURL(url) when the popup closes.
```

**Do not offer rename or delete unless `canManage` is true.** It is always false
for `booking` documents — that column is written by KiviCare at booking and never
by this API.

**Show `missing: true` items as unavailable, do not hide them.** The client
attached something and it is gone; a silently shorter list is worse than a
visible gap.

Upload: `POST /api/v1/encounters/{id}/documents`, multipart, fields `file` and
`name`. jpg/jpeg/png/webp/gif/pdf, 10 MB. A `linked: false` in the response means
the file is saved to the patient archive but is not tied to this encounter — show
it in the archive section and let the user retry.

Rename: `PATCH /api/v1/patient-medical-reports/{id}` with `{ "name": "..." }`.

**`GET /patient-medical-reports/{id}/file` changed.** It used to return `fileUrl`,
a WordPress URL that always answered 403 because the folder is `Deny from all`.
It now returns `contentPath`. If anything reads `fileUrl`, it was already broken.

**`GET /patient-medical-reports/{id}/preview` is gone.** It was a 501 stub; use
`/content`.
```

- [ ] **Step 5: Commit**

```bash
git add docs/api/openapi.yaml docs/api/postman-collection.json docs/handover/2026-08-02-frontend-checklist.md
git commit -m "docs(api): contract and front-end guidance for encounter documents"
```

---

### Task 13: Staging deploy runbook

**Files:**
- Modify: `docs/deploy/encounter-documents-staging-deploy.md` (created in Task 2)

**Interfaces:**
- Consumes: everything above
- Produces: a runbook, no code

- [ ] **Step 1: Write the runbook**

Replace the file created in Task 2 with the full version. The plugin goes first: it is additive, so the app keeps working without it, while the app's new routes are useless until it exists.

```markdown
# Encounter documents — staging deploy

Two artifacts, in this order: the plugin, then the app.

`prisma generate` is **not** required for this change — `schema.prisma` is
untouched. Do not run `db push` or `migrate`: `DATABASE_URL` is the WordPress
database.

## 0. Back up the plugin

    cd ~ && cp -a appointment.praktiqu.com/wp-content/mu-plugins/praktiqu-endpoint \
                  praktiqu-endpoint.bak-$(date +%F-%H%M)

## 1. Plugin

Upload `praktiqu-endpoint.tar.gz` to `~/`, then:

    cd ~ && rm -rf pe-staging && mkdir pe-staging && tar xzf praktiqu-endpoint.tar.gz -C pe-staging

Lint **before** it goes anywhere near `mu-plugins` — an mu-plugin is active the
instant the files land, and a fatal takes down the whole WordPress site including
the live booking form:

    for f in $(find ~/pe-staging -name '*.php'); do /usr/local/bin/php -l "$f"; done

Every line must read `No syntax errors detected`. Then swap it in:

    cd ~/appointment.praktiqu.com/wp-content/mu-plugins \
      && rm -rf praktiqu-endpoint \
      && mv ~/pe-staging/praktiqu-endpoint .

## 2. Smoke test the plugin route

Pick an attachment id:

    SELECT ID FROM wp_posts WHERE post_type='attachment' LIMIT 1;

Then, on the box:

    curl -sS -o /tmp/probe.bin -D /tmp/probe.hdr \
      -H "X-PraktiQU-Service-Token: $WP_SERVICE_TOKEN" \
      "https://<wp-host>/wp-json/praktiqu/v1/media/<id>"

Expect `HTTP/… 200`, a `Content-Type` matching the attachment, and
`X-Content-Type-Options: nosniff`. `/tmp/probe.bin` must open in a viewer.
A file starting with `{` means headers were sent after output had begun.

Without the token, the same URL must answer 401.

## 3. App

Deploy the built `.next` as usual and restart Passenger. No environment variable
changes: `WP_ENDPOINT` and `WP_SERVICE_TOKEN` are already set for the upload path,
and this change reuses both.

Remember that staging environment variables live in **cPanel**, not `.htaccess` —
editing `.htaccess` does nothing.

## 4. Verify end to end

With a PROFESSIONAL token, against an encounter that has an appointment:

    GET /api/v1/encounters/{id}/documents

Expect a 200 with both sections present. Then fetch one `contentPath` with the
same token and confirm bytes come back, not JSON.

Then the negative case, which is the one worth being sure about: take a `mediaId`
from one session and request it under a **different** session id. It must answer
404. A 200 here means the ownership guard is not wired, and any clinician could
walk the media library.

## 5. Known gaps left standing

- `uploads/kivicare-uploads/` is still world-readable. Nothing in this feature
  writes there, but the `custom-field` upload context does. Its own fix.
- `medReportScopeFor` still scopes a professional clinic-wide rather than to their
  own patients (design D7). Deliberate, and its own change when it happens.
```

- [ ] **Step 2: Run the whole suite one last time**

```bash
npm run test
npm run type-check
npm run lint
```

Expected: all green. Fix anything that is not before committing.

- [ ] **Step 3: Commit**

```bash
git add docs/deploy/encounter-documents-staging-deploy.md
git commit -m "docs(deploy): runbook for the encounter documents release"
```
