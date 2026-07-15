# File Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn uploaded file bytes into WordPress media attachment ids that the app's existing consumers already read by id, replacing the 501 stub at `POST /api/v1/custom-fields/file-upload`.

**Architecture:** Next.js validates (auth, size, magic-byte MIME sniff) then forwards each file over `multipart/form-data` to a new `POST /praktiqu/v1/media` route in the `praktiqu-endpoint` WP plugin, authenticated with `X-PraktiQU-Service-Token`. The plugin runs `media_handle_upload` so WordPress does its own MIME checks, thumbnails, and attachment bookkeeping, writing into a `kivicare-*` subfolder. Next.js never touches `wp_posts` or the uploads directory directly. This mirrors the existing payments bridge.

**Tech Stack:** Next.js 14.2.18 App Router (Node runtime), TypeScript, Zod, Vitest 2.x, PHP 7.4+ WordPress mu-plugin.

**Spec:** `docs/superpowers/specs/2026-07-15-file-upload-design.md`

## Global Constraints

- **Auth:** authenticated users only, via the existing `withAuth` wrapper from `@/lib/auth` (resolves to `src/lib/auth.ts`). No guest/public path. Do not build one.
- **Allowed types:** jpg, jpeg, png, webp, gif, pdf — and nothing else.
- **Max size:** 10 MB (`10 * 1024 * 1024` = 10485760 bytes) per file.
- **MIME:** decided by magic bytes, never by extension. The sniffed type must also agree with the extension.
- **Response convention:** this route is in the `custom-fields` family, which uses **plain REST**, not the KiviCare `kcOk` envelope. Success = `201`/`207` with a bare JSON body. Errors = RFC7807-style `{ type: 'about:blank', title, status }`, matching `src/app/api/v1/custom-fields/save-data/route.ts` and `src/app/api/v1/custom-fields/route.ts:68`. **Do not use `kcOk`/`kcFail` here** — those belong to the billing family and always return HTTP 200.
- **Service token header:** `X-PraktiQU-Service-Token`, value from `process.env.WORDPRESS_SERVICE_TOKEN`. Read it at call time, not module load.
- **Never** run `prisma db push` or `prisma migrate dev` — `DATABASE_URL` is the live WordPress database. This feature adds no tables.
- **No new npm dependencies.** MIME sniffing is hand-rolled (~30 lines) — `file-type` is not installed, is ESM-only, and would fight Next 14 + Vitest for six trivial signatures.
- Run tests with `npx vitest run <path>`. The 8 pre-existing billing failures (missing `wp_kc_*` tables in the local test DB) are unrelated — ignore them.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/services/uploads/validate-upload.ts` | **Create.** Pure validation: magic-byte sniff, allowlist, size, extension agreement. No I/O. |
| `tests/uploads/validate-upload.test.ts` | **Create.** Unit tests for the above. |
| `src/lib/wp-endpoint.ts` | **Modify.** Add `uploadMedia()` alongside the existing payments client. |
| `tests/uploads/wp-endpoint-media.test.ts` | **Create.** Unit tests for `uploadMedia`, modelled on `tests/payments/wp-endpoint.test.ts`. |
| `src/app/api/v1/custom-fields/file-upload/route.ts` | **Modify.** Replace the 501 stub with the real handler. |
| `tests/uploads/file-upload-route.test.ts` | **Create.** Route tests with a mocked bridge. |
| `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-media.php` | **Create.** The sideload handler + its own `upload_dir` filter. |
| `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-rest-controller.php` | **Modify.** Register `POST /media`; accept a `Media` dependency. |
| `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-plugin.php` | **Modify.** Construct `Media`, pass to the controller. |
| `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php` | **Modify.** `require_once` the media class; bump version 1.2.0 → 1.3.0. |
| `openapi.yaml` | **Modify.** Document `POST /praktiqu/v1/media` next to the other `/praktiqu/v1` routes. |

---

### Task 1: Pure upload validation

**Files:**
- Create: `src/services/uploads/validate-upload.ts`
- Test: `tests/uploads/validate-upload.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MAX_UPLOAD_BYTES: number` (10485760)
  - `MAX_UPLOAD_MB: number` (10)
  - `type AllowedMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'application/pdf'`
  - `sniffMime(bytes: Uint8Array): AllowedMime | null`
  - `extensionOf(name: string): string`
  - `validateUpload(file: { name: string; bytes: Uint8Array }): ValidationResult`
  - `type ValidationResult = { ok: true; mime: AllowedMime; ext: string } | { ok: false; error: UploadValidationError; message: string }`
  - `type UploadValidationError = 'EMPTY_FILE' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE' | 'EXTENSION_MISMATCH'`

- [ ] **Step 1: Write the failing test**

Create `tests/uploads/validate-upload.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  sniffMime,
  extensionOf,
  validateUpload,
  MAX_UPLOAD_BYTES,
} from '@/services/uploads/validate-upload';

/** Minimal valid magic-byte prefixes, padded so they are non-empty. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x00, 0x00, 0x00, 0x00, // size (ignored)
  0x57, 0x45, 0x42, 0x50, // WEBP
]);
const PHP_SCRIPT = new Uint8Array([...Buffer.from('<?php system($_GET["c"]); ?>', 'utf8')]);
const SVG = new Uint8Array([...Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8')]);

describe('sniffMime', () => {
  it('detects each allowed type from its magic bytes', () => {
    expect(sniffMime(JPEG)).toBe('image/jpeg');
    expect(sniffMime(PNG)).toBe('image/png');
    expect(sniffMime(GIF)).toBe('image/gif');
    expect(sniffMime(WEBP)).toBe('image/webp');
    expect(sniffMime(PDF)).toBe('application/pdf');
  });

  it('returns null for content that is not an allowed type', () => {
    expect(sniffMime(PHP_SCRIPT)).toBeNull();
    expect(sniffMime(SVG)).toBeNull();
    expect(sniffMime(new Uint8Array([0x00]))).toBeNull();
  });

  it('does not mistake a bare RIFF container for WebP', () => {
    const riffWav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(sniffMime(riffWav)).toBeNull();
  });
});

describe('extensionOf', () => {
  it('lowercases and strips the leading dot', () => {
    expect(extensionOf('Scan.PDF')).toBe('pdf');
    expect(extensionOf('a.b.png')).toBe('png');
  });

  it('returns an empty string when there is no usable extension', () => {
    expect(extensionOf('noext')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
  });
});

describe('validateUpload', () => {
  it('accepts a well-formed PNG', () => {
    expect(validateUpload({ name: 'x.png', bytes: PNG })).toEqual({
      ok: true, mime: 'image/png', ext: 'png',
    });
  });

  it('accepts jpg and jpeg for JPEG content', () => {
    expect(validateUpload({ name: 'x.jpg', bytes: JPEG }).ok).toBe(true);
    expect(validateUpload({ name: 'x.jpeg', bytes: JPEG }).ok).toBe(true);
  });

  it('accepts a PDF', () => {
    expect(validateUpload({ name: 'report.pdf', bytes: PDF })).toEqual({
      ok: true, mime: 'application/pdf', ext: 'pdf',
    });
  });

  it('rejects an empty file', () => {
    const r = validateUpload({ name: 'x.png', bytes: new Uint8Array(0) });
    expect(r).toMatchObject({ ok: false, error: 'EMPTY_FILE' });
  });

  it('rejects a file over the 10 MB limit', () => {
    const oversized = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    oversized.set(PNG, 0);
    const r = validateUpload({ name: 'x.png', bytes: oversized });
    expect(r).toMatchObject({ ok: false, error: 'TOO_LARGE' });
  });

  it('accepts a file exactly at the 10 MB limit', () => {
    const atLimit = new Uint8Array(MAX_UPLOAD_BYTES);
    atLimit.set(PNG, 0);
    expect(validateUpload({ name: 'x.png', bytes: atLimit }).ok).toBe(true);
  });

  it('rejects a PHP script even when named .png', () => {
    const r = validateUpload({ name: 'shell.png', bytes: PHP_SCRIPT });
    expect(r).toMatchObject({ ok: false, error: 'UNSUPPORTED_TYPE' });
  });

  it('rejects an SVG', () => {
    const r = validateUpload({ name: 'x.svg', bytes: SVG });
    expect(r).toMatchObject({ ok: false, error: 'UNSUPPORTED_TYPE' });
  });

  // The dangerous case: real image bytes carrying an executable extension.
  it('rejects real PNG bytes named .php', () => {
    const r = validateUpload({ name: 'payload.php', bytes: PNG });
    expect(r).toMatchObject({ ok: false, error: 'EXTENSION_MISMATCH' });
  });

  it('rejects content whose type disagrees with its extension', () => {
    const r = validateUpload({ name: 'x.png', bytes: PDF });
    expect(r).toMatchObject({ ok: false, error: 'EXTENSION_MISMATCH' });
  });

  it('rejects a file with no extension', () => {
    const r = validateUpload({ name: 'noext', bytes: PNG });
    expect(r).toMatchObject({ ok: false, error: 'EXTENSION_MISMATCH' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/uploads/validate-upload.test.ts`
Expected: FAIL — `Failed to resolve import "@/services/uploads/validate-upload"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/services/uploads/validate-upload.ts`:

```ts
/**
 * Pure validation for uploaded files. No I/O — every branch is unit-testable.
 *
 * The type is decided by magic bytes and must also agree with the filename
 * extension. Extension alone is never trusted: a PHP script named `.png` must
 * not pass, and real PNG bytes named `.php` must not pass either.
 */

export const MAX_UPLOAD_MB = 10;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export type AllowedMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/gif'
  | 'application/pdf';

/** Extensions each sniffed type is allowed to carry. */
export const EXTENSIONS_BY_MIME: Record<AllowedMime, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'application/pdf': ['pdf'],
};

export type UploadValidationError =
  | 'EMPTY_FILE'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'EXTENSION_MISMATCH';

export interface UploadCandidate {
  name: string;
  bytes: Uint8Array;
}

export type ValidationResult =
  | { ok: true; mime: AllowedMime; ext: string }
  | { ok: false; error: UploadValidationError; message: string };

/** Identify an allowed type by its magic bytes, or null if unrecognised. */
export function sniffMime(bytes: Uint8Array): AllowedMime | null {
  const at = (sig: readonly number[], offset = 0): boolean =>
    bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);

  if (at([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (at([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  // WebP is a RIFF container: "RIFF" .... "WEBP". Both markers are required.
  if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (at([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  return null;
}

/** Lowercased extension without the dot, or '' when absent. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function validateUpload(file: UploadCandidate): ValidationResult {
  if (file.bytes.length === 0) {
    return { ok: false, error: 'EMPTY_FILE', message: 'File is empty' };
  }
  if (file.bytes.length > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: 'TOO_LARGE',
      message: `File exceeds the ${MAX_UPLOAD_MB} MB limit`,
    };
  }
  const mime = sniffMime(file.bytes);
  if (!mime) {
    return {
      ok: false,
      error: 'UNSUPPORTED_TYPE',
      message: 'Unsupported file type — allowed: JPG, PNG, WebP, GIF, PDF',
    };
  }
  const ext = extensionOf(file.name);
  if (!EXTENSIONS_BY_MIME[mime].includes(ext)) {
    return {
      ok: false,
      error: 'EXTENSION_MISMATCH',
      message: `File content (${mime}) does not match the "${ext || 'missing'}" extension`,
    };
  }
  return { ok: true, mime, ext };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/uploads/validate-upload.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/services/uploads/validate-upload.ts tests/uploads/validate-upload.test.ts
git commit -m "feat(upload): pure magic-byte validation for uploads

Type is decided by magic bytes and must agree with the extension, so a PHP
script named .png and real PNG bytes named .php are both rejected. 10 MB cap."
```

---

### Task 2: `uploadMedia` bridge to the plugin

**Files:**
- Modify: `src/lib/wp-endpoint.ts` (append; do not disturb the payments client)
- Test: `tests/uploads/wp-endpoint-media.test.ts`

**Interfaces:**
- Consumes: `AllowedMime` from Task 1. Existing `serviceToken()` and `WpEndpointError` already in `wp-endpoint.ts`.
- Produces:
  - `type UploadContext = 'medical-report' | 'custom-field'`
  - `interface UploadMediaInput { filename: string; contentType: AllowedMime; bytes: Uint8Array; context: UploadContext }`
  - `interface UploadMediaResult { mediaId: number; url: string; name: string }`
  - `uploadMedia(input: UploadMediaInput): Promise<UploadMediaResult>`

- [ ] **Step 1: Write the failing test**

Create `tests/uploads/wp-endpoint-media.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('wp-endpoint media client', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, WORDPRESS_URL: 'http://wp.test', WORDPRESS_SERVICE_TOKEN: 'tok' };
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    process.env = OLD_ENV;
    vi.unstubAllGlobals();
  });

  it('posts multipart to /praktiqu/v1/media with the service token header', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ mediaId: 42, url: 'http://wp.test/u/kivicare-uploads/x.png', name: 'x' }),
    });
    const { uploadMedia } = await import('@/lib/wp-endpoint');
    const result = await uploadMedia({
      filename: 'x.png', contentType: 'image/png', bytes: PNG_BYTES, context: 'custom-field',
    });

    expect(result).toEqual({ mediaId: 42, url: 'http://wp.test/u/kivicare-uploads/x.png', name: 'x' });

    const [url, opts] = (fetch as any).mock.calls[0];
    expect(url).toBe('http://wp.test/wp-json/praktiqu/v1/media');
    expect(opts.method).toBe('POST');
    expect(opts.headers['X-PraktiQU-Service-Token']).toBe('tok');
    // Content-Type must NOT be set by hand — fetch must add the multipart boundary.
    expect(opts.headers['Content-Type']).toBeUndefined();
    expect(opts.body).toBeInstanceOf(FormData);
    expect((opts.body as FormData).get('context')).toBe('custom-field');
    const sent = (opts.body as FormData).get('file') as File;
    expect(sent.name).toBe('x.png');
    expect(sent.type).toBe('image/png');
  });

  it('forwards the medical-report context', async () => {
    (fetch as any).mockResolvedValue({
      ok: true, json: async () => ({ mediaId: 1, url: 'u', name: 'n' }),
    });
    const { uploadMedia } = await import('@/lib/wp-endpoint');
    await uploadMedia({
      filename: 'r.pdf', contentType: 'application/pdf', bytes: PNG_BYTES, context: 'medical-report',
    });
    const [, opts] = (fetch as any).mock.calls[0];
    expect((opts.body as FormData).get('context')).toBe('medical-report');
  });

  it('throws WpEndpointError carrying the upstream status on a non-ok response', async () => {
    (fetch as any).mockResolvedValue({
      ok: false, status: 413, statusText: 'Payload Too Large', text: async () => 'too big',
    });
    const { uploadMedia, WpEndpointError } = await import('@/lib/wp-endpoint');
    await expect(uploadMedia({
      filename: 'x.png', contentType: 'image/png', bytes: PNG_BYTES, context: 'custom-field',
    })).rejects.toMatchObject({ name: 'WpEndpointError', status: 413 });
    await expect(uploadMedia({
      filename: 'x.png', contentType: 'image/png', bytes: PNG_BYTES, context: 'custom-field',
    })).rejects.toThrow(WpEndpointError);
  });

  it('throws WpEndpointError on invalid JSON', async () => {
    (fetch as any).mockResolvedValue({
      ok: true, status: 200, json: async () => { throw new Error('bad json'); },
    });
    const { uploadMedia, WpEndpointError } = await import('@/lib/wp-endpoint');
    await expect(uploadMedia({
      filename: 'x.png', contentType: 'image/png', bytes: PNG_BYTES, context: 'custom-field',
    })).rejects.toThrow(WpEndpointError);
  });

  it('throws WpEndpointError when the response lacks a numeric mediaId', async () => {
    (fetch as any).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ url: 'u', name: 'n' }),
    });
    const { uploadMedia, WpEndpointError } = await import('@/lib/wp-endpoint');
    await expect(uploadMedia({
      filename: 'x.png', contentType: 'image/png', bytes: PNG_BYTES, context: 'custom-field',
    })).rejects.toThrow(WpEndpointError);
  });

  it('throws WpEndpointError when WORDPRESS_SERVICE_TOKEN is not set', async () => {
    process.env.WORDPRESS_SERVICE_TOKEN = '';
    const { uploadMedia, WpEndpointError } = await import('@/lib/wp-endpoint');
    await expect(uploadMedia({
      filename: 'x.png', contentType: 'image/png', bytes: PNG_BYTES, context: 'custom-field',
    })).rejects.toThrow(WpEndpointError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/uploads/wp-endpoint-media.test.ts`
Expected: FAIL — `uploadMedia is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/wp-endpoint.ts` (after `getWcOrderStatus`). Also add the media base URL next to `WP_PAYMENTS_BASE` near the top:

```ts
const WP_MEDIA_URL = `${WP_ENDPOINT}/wp-json/praktiqu/v1/media`;
```

Add this import at the **top** of the file, with the other imports (`import type` is erased at compile time, so it adds no runtime coupling to the services layer):

```ts
import type { AllowedMime } from '@/services/uploads/validate-upload';
```

Then append at the end of the file:

```ts
/* ---------------------------------------------------------------- media --- */

export type UploadContext = 'medical-report' | 'custom-field';

export interface UploadMediaInput {
  filename: string;
  contentType: AllowedMime;
  bytes: Uint8Array;
  context: UploadContext;
}

export interface UploadMediaResult {
  mediaId: number;
  url: string;
  name: string;
}

/**
 * Sideload one file into the WordPress media library via the plugin.
 *
 * Content-Type is deliberately left unset so fetch generates the multipart
 * boundary itself; setting it by hand produces a body WP cannot parse.
 */
export async function uploadMedia(input: UploadMediaInput): Promise<UploadMediaResult> {
  const form = new FormData();
  form.append('context', input.context);
  form.append(
    'file',
    new Blob([input.bytes], { type: input.contentType }),
    input.filename,
  );

  const res = await fetch(WP_MEDIA_URL, {
    method: 'POST',
    headers: { 'X-PraktiQU-Service-Token': serviceToken() },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new WpEndpointError(`Media upload failed ${res.status}: ${text}`, res.status);
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new WpEndpointError('Media upload returned invalid JSON', res.status);
  }

  if (typeof data?.mediaId !== 'number' || !Number.isFinite(data.mediaId)) {
    throw new WpEndpointError('Media upload returned no media id', res.status);
  }

  return { mediaId: data.mediaId, url: String(data.url ?? ''), name: String(data.name ?? input.filename) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/uploads/wp-endpoint-media.test.ts`
Expected: PASS.

Then confirm the payments client still works:

Run: `npx vitest run tests/payments/wp-endpoint.test.ts`
Expected: PASS — 4 tests, unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wp-endpoint.ts tests/uploads/wp-endpoint-media.test.ts
git commit -m "feat(upload): add uploadMedia bridge to the WP plugin

Forwards one file as multipart to POST /praktiqu/v1/media with the service
token, mirroring the payments client. Leaves Content-Type unset so fetch
generates the boundary."
```

---

### Task 3: The route

**Files:**
- Modify: `src/app/api/v1/custom-fields/file-upload/route.ts` (replace the 501 stub entirely)
- Test: `tests/uploads/file-upload-route.test.ts`

**Interfaces:**
- Consumes: `validateUpload`, `MAX_UPLOAD_BYTES` (Task 1); `uploadMedia`, `WpEndpointError`, `UploadContext` (Task 2); `withAuth` from `@/lib/auth`; `bearerToken` from `tests/helpers/auth`.
- Produces: `POST` route handler. Response bodies:
  - `201 { files: [{ name, mediaId, url }] }`
  - `207 { files: [ { name, mediaId, url } | { name, error } ] }`
  - `400 | 422 | 502 { type: 'about:blank', title, status, files? }`

- [ ] **Step 1: Write the failing test**

Create `tests/uploads/file-upload-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { bearerToken } from '../helpers/auth';

// vi.hoisted is REQUIRED here: vi.mock is hoisted above ordinary `const`
// declarations, so a plain `const uploadMediaMock = vi.fn()` referenced from
// the factory throws "Cannot access before initialization".
const { uploadMediaMock } = vi.hoisted(() => ({ uploadMediaMock: vi.fn() }));

vi.mock('@/lib/wp-endpoint', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wp-endpoint')>();
  return { ...actual, uploadMedia: uploadMediaMock };
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const PHP_SCRIPT = new Uint8Array([...Buffer.from('<?php echo 1; ?>', 'utf8')]);

function filePart(name: string, bytes: Uint8Array, type: string): File {
  return new File([bytes], name, { type });
}

async function callRoute(form: FormData, opts: { auth?: boolean } = {}) {
  const headers = new Headers();
  if (opts.auth !== false) {
    headers.set('authorization', `Bearer ${await bearerToken({ userId: 'u1', role: 'CLINIC_ADMIN' })}`);
  }
  const req = new NextRequest('http://localhost/api/v1/custom-fields/file-upload', {
    method: 'POST',
    body: form,
    headers,
  });
  const { POST } = await import('@/app/api/v1/custom-fields/file-upload/route');
  return POST(req);
}

describe('POST /api/v1/custom-fields/file-upload', () => {
  beforeEach(() => {
    uploadMediaMock.mockReset();
  });

  it('rejects an unauthenticated request with 401', async () => {
    const form = new FormData();
    form.append('file', filePart('x.png', PNG, 'image/png'));
    const res = await callRoute(form, { auth: false });
    expect(res.status).toBe(401);
    expect(uploadMediaMock).not.toHaveBeenCalled();
  });

  it('returns 400 when no file part is present', async () => {
    const form = new FormData();
    form.append('context', 'custom-field');
    const res = await callRoute(form);
    expect(res.status).toBe(400);
    expect(uploadMediaMock).not.toHaveBeenCalled();
  });

  it('uploads a single valid file and returns 201 with the media id', async () => {
    uploadMediaMock.mockResolvedValue({ mediaId: 42, url: 'http://wp/x.png', name: 'x' });
    const form = new FormData();
    form.append('file', filePart('x.png', PNG, 'image/png'));
    const res = await callRoute(form);
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      files: [{ name: 'x.png', mediaId: 42, url: 'http://wp/x.png' }],
    });
  });

  it('defaults the context to custom-field and forwards the sniffed mime', async () => {
    uploadMediaMock.mockResolvedValue({ mediaId: 1, url: 'u', name: 'n' });
    const form = new FormData();
    form.append('file', filePart('x.png', PNG, 'image/png'));
    await callRoute(form);
    expect(uploadMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'x.png', contentType: 'image/png', context: 'custom-field' }),
    );
  });

  it('forwards an explicit medical-report context', async () => {
    uploadMediaMock.mockResolvedValue({ mediaId: 1, url: 'u', name: 'n' });
    const form = new FormData();
    form.append('context', 'medical-report');
    form.append('file', filePart('r.pdf', PDF, 'application/pdf'));
    await callRoute(form);
    expect(uploadMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'medical-report' }),
    );
  });

  it('falls back to custom-field for an unknown context', async () => {
    uploadMediaMock.mockResolvedValue({ mediaId: 1, url: 'u', name: 'n' });
    const form = new FormData();
    form.append('context', 'not-a-context');
    form.append('file', filePart('x.png', PNG, 'image/png'));
    await callRoute(form);
    expect(uploadMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'custom-field' }),
    );
  });

  it('uploads multiple files and returns 201 with one entry per file', async () => {
    uploadMediaMock
      .mockResolvedValueOnce({ mediaId: 1, url: 'u1', name: 'a' })
      .mockResolvedValueOnce({ mediaId: 2, url: 'u2', name: 'b' });
    const form = new FormData();
    form.append('file', filePart('a.png', PNG, 'image/png'));
    form.append('file', filePart('b.pdf', PDF, 'application/pdf'));
    const res = await callRoute(form);
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      files: [
        { name: 'a.png', mediaId: 1, url: 'u1' },
        { name: 'b.pdf', mediaId: 2, url: 'u2' },
      ],
    });
  });

  // validate-all-then-write: one bad file must prevent ALL writes.
  it('returns 422 and writes nothing when any file fails validation', async () => {
    const form = new FormData();
    form.append('file', filePart('good.png', PNG, 'image/png'));
    form.append('file', filePart('bad.png', PHP_SCRIPT, 'image/png'));
    const res = await callRoute(form);
    expect(res.status).toBe(422);
    expect(uploadMediaMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.title).toBeDefined();
    expect(body.files).toEqual([
      expect.objectContaining({ name: 'bad.png' }),
    ]);
  });

  it('returns 422 for real image bytes carrying a .php extension', async () => {
    const form = new FormData();
    form.append('file', filePart('payload.php', PNG, 'image/png'));
    const res = await callRoute(form);
    expect(res.status).toBe(422);
    expect(uploadMediaMock).not.toHaveBeenCalled();
  });

  it('returns 207 when some files fail to sideload after validation passed', async () => {
    uploadMediaMock
      .mockResolvedValueOnce({ mediaId: 1, url: 'u1', name: 'a' })
      .mockRejectedValueOnce(new Error('wp exploded'));
    const form = new FormData();
    form.append('file', filePart('a.png', PNG, 'image/png'));
    form.append('file', filePart('b.pdf', PDF, 'application/pdf'));
    const res = await callRoute(form);
    expect(res.status).toBe(207);
    const body = await res.json();
    expect(body.files[0]).toEqual({ name: 'a.png', mediaId: 1, url: 'u1' });
    expect(body.files[1]).toMatchObject({ name: 'b.pdf' });
    expect(body.files[1].error).toBeDefined();
  });

  it('returns 502 when every file fails to sideload', async () => {
    const { WpEndpointError } = await import('@/lib/wp-endpoint');
    uploadMediaMock.mockRejectedValue(new WpEndpointError('wp down', 503));
    const form = new FormData();
    form.append('file', filePart('a.png', PNG, 'image/png'));
    const res = await callRoute(form);
    expect(res.status).toBe(502);
  });

  it('never leaks a 500 when the bridge throws an unexpected error', async () => {
    uploadMediaMock.mockRejectedValue(new Error('boom'));
    const form = new FormData();
    form.append('file', filePart('a.png', PNG, 'image/png'));
    const res = await callRoute(form);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/uploads/file-upload-route.test.ts`
Expected: FAIL — the stub returns 501 for every case.

If `new NextRequest(url, { body: form })` throws in the Node test environment, construct a plain `Request` instead and cast: `const req = new Request(url, { method: 'POST', body: form, headers }) as unknown as NextRequest;`. Do not change the handler to accommodate the test.

- [ ] **Step 3: Write minimal implementation**

Replace the entire contents of `src/app/api/v1/custom-fields/file-upload/route.ts`:

```ts
/**
 * POST /api/v1/custom-fields/file-upload
 *
 * Accepts multipart/form-data and returns WordPress media attachment ids.
 * Authenticated users only. Files are validated here (magic-byte sniff, size,
 * extension agreement) and then sideloaded by the WP plugin — Next.js never
 * writes the media library directly.
 *
 * Every file is validated before any file is written, so a validation failure
 * cannot leave orphaned media behind.
 *
 * Responses follow the plain-REST convention of the custom-fields family, not
 * the KiviCare kcOk envelope.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import {
  validateUpload,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
  type AllowedMime,
} from '@/services/uploads/validate-upload';
import { uploadMedia, type UploadContext } from '@/lib/wp-endpoint';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONTEXTS: readonly UploadContext[] = ['medical-report', 'custom-field'];
const DEFAULT_CONTEXT: UploadContext = 'custom-field';

function problem(title: string, status: number, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ type: 'about:blank', title, status, ...extra }, { status });
}

function isFilePart(value: FormDataEntryValue): value is File {
  return typeof value === 'object' && value !== null && 'arrayBuffer' in value;
}

export const POST = withAuth(async (req: NextRequest) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return problem('Expected multipart/form-data', 400);
  }

  const rawContext = String(form.get('context') ?? DEFAULT_CONTEXT);
  const context: UploadContext = CONTEXTS.includes(rawContext as UploadContext)
    ? (rawContext as UploadContext)
    : DEFAULT_CONTEXT;

  const parts = form.getAll('file').filter(isFilePart);
  if (parts.length === 0) {
    return problem('No file provided', 400);
  }

  // Validate every file before writing any of them.
  const accepted: Array<{ name: string; bytes: Uint8Array; mime: AllowedMime }> = [];
  const rejected: Array<{ name: string; error: string }> = [];

  for (const part of parts) {
    // Check the declared size first so an oversized upload is never buffered.
    if (part.size > MAX_UPLOAD_BYTES) {
      rejected.push({ name: part.name, error: `File exceeds the ${MAX_UPLOAD_MB} MB limit` });
      continue;
    }
    const bytes = new Uint8Array(await part.arrayBuffer());
    const result = validateUpload({ name: part.name, bytes });
    if (!result.ok) {
      rejected.push({ name: part.name, error: result.message });
      continue;
    }
    accepted.push({ name: part.name, bytes, mime: result.mime });
  }

  if (rejected.length > 0) {
    return problem('File validation failed', 422, { files: rejected });
  }

  const files: Array<Record<string, unknown>> = [];
  let failures = 0;

  for (const file of accepted) {
    try {
      const uploaded = await uploadMedia({
        filename: file.name,
        contentType: file.mime,
        bytes: file.bytes,
        context,
      });
      files.push({ name: file.name, mediaId: uploaded.mediaId, url: uploaded.url });
    } catch (err) {
      failures += 1;
      // Deliberately generic: upstream detail must not reach the client.
      console.error('[file-upload] sideload failed', { name: file.name, err });
      files.push({ name: file.name, error: 'Upload failed' });
    }
  }

  if (failures === accepted.length) {
    return problem('Upload failed', 502, { files });
  }
  if (failures > 0) {
    return NextResponse.json({ files }, { status: 207 });
  }
  return NextResponse.json({ files }, { status: 201 });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/uploads/file-upload-route.test.ts`
Expected: PASS — all 13 tests green.

Then typecheck:

Run: `npx tsc --noEmit`
Expected: no errors introduced by these files.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/custom-fields/file-upload/route.ts tests/uploads/file-upload-route.test.ts
git commit -m "feat(upload): implement the file-upload route behind the 501 stub

Authed-only multipart -> media ids. Validates every file before writing any,
so a bad file cannot orphan media. 201 all-ok, 207 partial, 422 validation,
502 upstream. Plain-REST responses per the custom-fields family."
```

---

### Task 4: Plugin media route (`POST /praktiqu/v1/media`)

**Files:**
- Create: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-media.php`
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-rest-controller.php`
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-plugin.php`
- Modify: `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php`

**Interfaces:**
- Consumes: `Plugin::verify_service_token`, `PRAKTIQU_ENDPOINT_REST_NAMESPACE` ('praktiqu/v1').
- Produces: `PraktiQU\Endpoint\Media::sideload(\WP_REST_Request $request): array|\WP_Error` returning `['mediaId' => int, 'url' => string, 'name' => string]`. Consumed over HTTP by Task 2's `uploadMedia`.

There is no PHP test harness in this repo, so this task is verified by `php -l` plus the end-to-end check in Task 5.

- [ ] **Step 1: Create the media class**

Create `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-media.php`:

```php
<?php
/**
 * Media — sideloads uploaded files into the WordPress media library.
 *
 * Called service-to-service by the Next.js app. There is NO logged-in user in
 * these requests, which is why this class sets its own `upload_dir` filter
 * instead of relying on KiviCare's KCMediaHandler: that filter only fires for
 * users holding a KiviCare role, so it would silently no-op here and files
 * would land in the default year/month folder.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class Media
{
    /** Upload subfolder per context, relative to the uploads basedir. */
    private const SUBDIR_BY_CONTEXT = [
        'medical-report' => '/kivicare-reports',
        'custom-field'   => '/kivicare-uploads',
    ];

    private const DEFAULT_CONTEXT = 'custom-field';

    /**
     * Handle POST /praktiqu/v1/media.
     *
     * @return array|\WP_Error
     */
    public function sideload(\WP_REST_Request $request)
    {
        $files = $request->get_file_params();

        if (empty($files['file'])) {
            // A body that arrived but produced no $_FILES almost always means
            // PHP discarded it for exceeding post_max_size. Say so loudly —
            // otherwise this looks like "no file sent" and wastes hours.
            $length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
            if ($length > 0) {
                return new \WP_Error(
                    'praktiqu_upload_body_dropped',
                    sprintf(
                        'Request carried %d bytes but PHP exposed no file. post_max_size=%s, upload_max_filesize=%s.',
                        $length,
                        (string) ini_get('post_max_size'),
                        (string) ini_get('upload_max_filesize')
                    ),
                    ['status' => 413]
                );
            }
            return new \WP_Error('praktiqu_no_file', 'No file provided.', ['status' => 400]);
        }

        $file = $files['file'];
        $error_code = isset($file['error']) ? (int) $file['error'] : UPLOAD_ERR_OK;
        if ($error_code !== UPLOAD_ERR_OK) {
            return new \WP_Error(
                'praktiqu_upload_error',
                $this->upload_error_message($error_code),
                ['status' => $error_code === UPLOAD_ERR_INI_SIZE || $error_code === UPLOAD_ERR_FORM_SIZE ? 413 : 400]
            );
        }

        $context = (string) ($request->get_param('context') ?? self::DEFAULT_CONTEXT);
        $subdir  = self::SUBDIR_BY_CONTEXT[$context] ?? self::SUBDIR_BY_CONTEXT[self::DEFAULT_CONTEXT];

        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        require_once ABSPATH . 'wp-admin/includes/image.php';

        $filter = static function (array $uploads) use ($subdir): array {
            $uploads['path']   = $uploads['basedir'] . $subdir;
            $uploads['url']    = $uploads['baseurl'] . $subdir;
            $uploads['subdir'] = ''; // flat: no year/month nesting
            if (!file_exists($uploads['path'])) {
                wp_mkdir_p($uploads['path']);
            }
            return $uploads;
        };

        add_filter('upload_dir', $filter);
        try {
            // media_handle_upload (not sideload) is correct here: the file is a
            // genuine PHP upload in $_FILES, so it must be moved with
            // move_uploaded_file. test_form => false because there is no
            // wp-admin form nonce in a service-to-service request.
            $attachment_id = media_handle_upload('file', 0, [], ['test_form' => false]);
        } finally {
            remove_filter('upload_dir', $filter);
        }

        if (is_wp_error($attachment_id)) {
            return new \WP_Error(
                'praktiqu_sideload_failed',
                $attachment_id->get_error_message(),
                ['status' => 400]
            );
        }

        $attachment_id = (int) $attachment_id;
        $url = wp_get_attachment_url($attachment_id);

        return [
            'mediaId' => $attachment_id,
            'url'     => is_string($url) ? $url : '',
            'name'    => (string) get_the_title($attachment_id),
        ];
    }

    private function upload_error_message(int $code): string
    {
        switch ($code) {
            case UPLOAD_ERR_INI_SIZE:
                return sprintf('File exceeds the server upload_max_filesize (%s).', (string) ini_get('upload_max_filesize'));
            case UPLOAD_ERR_FORM_SIZE:
                return 'File exceeds the form-declared maximum size.';
            case UPLOAD_ERR_PARTIAL:
                return 'File was only partially uploaded.';
            case UPLOAD_ERR_NO_FILE:
                return 'No file was uploaded.';
            case UPLOAD_ERR_NO_TMP_DIR:
                return 'Server is missing a temporary folder.';
            case UPLOAD_ERR_CANT_WRITE:
                return 'Server failed to write the file to disk.';
            case UPLOAD_ERR_EXTENSION:
                return 'A PHP extension stopped the upload.';
            default:
                return 'Unknown upload error.';
        }
    }
}
```

- [ ] **Step 2: Lint the new file**

Run: `php -l Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-media.php`
Expected: `No syntax errors detected`

If `php` is not on PATH locally, skip to the server-side lint in Task 5 — but do not deploy an unlinted file.

- [ ] **Step 3: Register the route in the REST controller**

In `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-rest-controller.php`:

Add the property and constructor parameter (the class currently holds `Service $service`, `Jobs $jobs`, `Payments $payments`):

```php
    private Service $service;
    private Jobs $jobs;
    private Payments $payments;
    private Media $media;

    public function __construct(Service $service, Jobs $jobs, Payments $payments, Media $media)
    {
        $this->service = $service;
        $this->jobs = $jobs;
        $this->payments = $payments;
        $this->media = $media;
    }
```

Then register the route inside `register_routes()`, after the `/health` block:

```php
        // POST /praktiqu/v1/media — sideload a file into the WP media library
        register_rest_route($ns, '/media', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_media_upload'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'context' => [
                    'required' => false,
                    'type'     => 'string',
                    'enum'     => ['medical-report', 'custom-field'],
                    'default'  => 'custom-field',
                ],
            ],
        ]);
```

And add the handler method to the class:

```php
    /**
     * POST /praktiqu/v1/media
     *
     * @return \WP_REST_Response|\WP_Error
     */
    public function handle_media_upload(\WP_REST_Request $request)
    {
        $result = $this->media->sideload($request);
        if (is_wp_error($result)) {
            return $result;
        }
        return rest_ensure_response($result);
    }
```

- [ ] **Step 4: Wire the Media class into the plugin bootstrap**

In `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-plugin.php`, add the property next to the existing ones (`public REST_Controller $rest;` etc.) and construct it before the controller (currently lines ~27-30):

```php
        $this->service  = new Service();
        $this->payments = new Payments();
        $this->media    = new Media();
        $this->jobs     = new Jobs($this->service, $this->payments);
        $this->rest     = new REST_Controller($this->service, $this->jobs, $this->payments, $this->media);
```

Declare the property alongside the others in the class:

```php
    public Media $media;
```

In `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php`, require the class (after the payments require on line 30) — order matters because there is no autoloader:

```php
require_once PRAKTIQU_ENDPOINT_PATH . 'includes/class-praktiqu-endpoint-media.php';
```

- [ ] **Step 5: Bump the plugin version to 1.3.0**

In `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php`, both the header (line 6) and the constant (line 19):

```php
 * Version:           1.3.0
```

```php
define('PRAKTIQU_ENDPOINT_VERSION', '1.3.0');
```

- [ ] **Step 6: Lint every modified PHP file**

Run:
```bash
php -l Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php
php -l Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-media.php
php -l Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-rest-controller.php
php -l Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-plugin.php
```
Expected: `No syntax errors detected` for each.

- [ ] **Step 7: Commit**

```bash
git add Wordpress-Plugin/praktiqu-endpoint/
git commit -m "feat(plugin): add POST /praktiqu/v1/media, bump to 1.3.0

Sideloads a file into the WP media library via media_handle_upload with
test_form disabled. Sets its own upload_dir filter because KCMediaHandler
only fires for KiviCare-role users and would no-op in a service-token
request. Reports a post_max_size overflow as an explicit 413 rather than
looking like 'no file sent'."
```

---

### Task 5: Deploy and verify end-to-end

**Files:** none — this task deploys and verifies Tasks 1-4.

**Interfaces:**
- Consumes: everything above.
- Produces: a confirmed media id from a real upload, and a definitive answer on PHP's upload limits.

Deployment mechanics come from the `staging-deploy-mechanics` memory. SSH: `praktiqu@101.50.1.106 -p 45022` with an **OpenSSH/PEM-format** key (`ssh -i`); the `.ppk` only works via Windows `plink.exe`/`pscp.exe` at `/mnt/c/Program Files/PuTTY/`. Port 45022 has been intermittently unreachable — if it times out, ask the user for access rather than guessing. Server PHP for linting: `/usr/local/bin/php` (8.3.31).

**Deploy the plugin first.** The app's route is useless until `/praktiqu/v1/media` exists, and the plugin is additive so it cannot break the deployed app.

- [ ] **Step 1: Upload the plugin to a temp dir and lint it on the server**

The plugin is an mu-plugin: it goes live the moment files land in place, so lint in a temp dir first and never edit in place.

```bash
# from repo root, replace <KEY> with the OpenSSH-format private key path
scp -P 45022 -i <KEY> -r Wordpress-Plugin/praktiqu-endpoint \
  praktiqu@101.50.1.106:/home/praktiqu/praktiqu-endpoint-1.3.0

ssh -p 45022 -i <KEY> praktiqu@101.50.1.106 \
  'for f in /home/praktiqu/praktiqu-endpoint-1.3.0/praktiqu-endpoint.php /home/praktiqu/praktiqu-endpoint-1.3.0/includes/*.php; do /usr/local/bin/php -l "$f" || exit 1; done'
```
Expected: `No syntax errors detected` for every file. **Do not proceed on any error.**

- [ ] **Step 2: Back up the live plugin, then swap**

```bash
ssh -p 45022 -i <KEY> praktiqu@101.50.1.106 '
  set -e
  cd /home/praktiqu/appointment.praktiqu.com/wp-content/mu-plugins
  cp -r praktiqu-endpoint praktiqu-endpoint.bak-$(date +%Y%m%d-%H%M%S)
  rm -rf praktiqu-endpoint
  mv /home/praktiqu/praktiqu-endpoint-1.3.0 praktiqu-endpoint
  grep -n "PRAKTIQU_ENDPOINT_VERSION" praktiqu-endpoint/praktiqu-endpoint.php
'
```
Expected: the grep prints `1.3.0`.

- [ ] **Step 3: Confirm the plugin still boots and the route is registered**

```bash
curl -4 -sS -o /dev/null -w 'health=%{http_code}\n' \
  -H "X-PraktiQU-Service-Token: $TOKEN" \
  https://appointment.praktiqu.com/wp-json/praktiqu/v1/health

curl -4 -sS -w '\nmedia_no_token=%{http_code}\n' -X POST \
  -F 'file=@probe.png' \
  https://appointment.praktiqu.com/wp-json/praktiqu/v1/media
```
Expected: `health=200` (proves the plugin loaded — a fatal would 500 everything), and `media_no_token=401` with `praktiqu_service_token_missing` (proves the route now exists and is guarded; a 404 means registration failed).

`$TOKEN` is the `WORDPRESS_SERVICE_TOKEN` from the staging `.htaccess`.

- [ ] **Step 4: Upload a real file through the plugin and confirm the media id resolves**

```bash
curl -4 -sS -X POST \
  -H "X-PraktiQU-Service-Token: $TOKEN" \
  -F 'context=custom-field' \
  -F 'file=@probe.png' \
  https://appointment.praktiqu.com/wp-json/praktiqu/v1/media
```
Expected: `{"mediaId":<n>,"url":"https://appointment.praktiqu.com/wp-content/uploads/kivicare-uploads/probe.png","name":"probe"}`

Then confirm the URL actually serves the file:

```bash
curl -4 -sS -o /dev/null -w 'file=%{http_code} type=%{content_type}\n' '<url from above>'
```
Expected: `file=200 type=image/png`. The path must contain `kivicare-uploads` — if it contains a year/month folder instead (e.g. `/2026/07/`), the `upload_dir` filter is not being applied.

- [ ] **Step 5: Settle the PHP upload-limit question**

This is the open unknown the spec records: the WAF probe proved the *edge* accepts 10 MB, not that *PHP* keeps it.

```bash
head -c 10485760 /dev/urandom > /tmp/big.bin
# a real 10MB PNG: magic bytes + padding, so it passes app validation too
( printf '\x89PNG\r\n\x1a\n'; head -c 10485752 /dev/urandom ) > /tmp/big.png

curl -4 -sS -X POST \
  -H "X-PraktiQU-Service-Token: $TOKEN" \
  -F 'file=@/tmp/big.png' \
  https://appointment.praktiqu.com/wp-json/praktiqu/v1/media
```
Expected, one of:
- A JSON `mediaId` → PHP accepts 10 MB. The app's limit is honest. Done.
- `praktiqu_upload_body_dropped` (413) → **PHP's `post_max_size` is below 10 MB.** The message reports the actual `post_max_size` and `upload_max_filesize`. Lower `MAX_UPLOAD_MB` in `src/services/uploads/validate-upload.ts` to fit under the real limit (and update the spec), or ask the user to raise the PHP limits. Do not leave the app advertising a limit PHP will not honour.
- `praktiqu_upload_error` (413) with `upload_max_filesize` → same conclusion, different knob.

Record the answer in the spec's "PHP upload limits" section either way.

- [ ] **Step 6: Deploy the Next.js app**

```bash
NEXT_PUBLIC_APP_URL=https://staging2.praktiqu.com npm run build
tar czf /tmp/next-build.tgz --exclude=.next/cache .next
scp -P 45022 -i <KEY> /tmp/next-build.tgz praktiqu@101.50.1.106:/tmp/

ssh -p 45022 -i <KEY> praktiqu@101.50.1.106 '
  set -e
  cd /home/praktiqu/staging2.praktiqu.com
  mv .next .next.bak-$(date +%Y%m%d-%H%M%S)
  tar xzf /tmp/next-build.tgz
  mkdir -p .next/cache
  cloudlinux-selector restart --json --interpreter nodejs --user praktiqu --app-root /home/praktiqu/staging2.praktiqu.com
'
```
Expected: build succeeds; restart returns JSON with no error.

- [ ] **Step 7: Verify the full path end-to-end**

Mint a staging JWT for a real staff user (sign with the staging `AUTH_SECRET` from `.htaccess`, same shape as `tests/helpers/auth.ts`), then:

```bash
# unauthenticated -> 401, NOT 501
curl -4 -sS -o /dev/null -w 'noauth=%{http_code}\n' -X POST \
  -F 'file=@probe.png' \
  https://staging2.praktiqu.com/api/v1/custom-fields/file-upload

# authenticated happy path -> 201 + media id
curl -4 -sS -X POST \
  -H "Authorization: Bearer $JWT" \
  -F 'context=custom-field' \
  -F 'file=@probe.png' \
  https://staging2.praktiqu.com/api/v1/custom-fields/file-upload

# a PHP script named .png -> 422, and nothing written
printf '<?php echo 1; ?>' > /tmp/shell.png
curl -4 -sS -X POST \
  -H "Authorization: Bearer $JWT" \
  -F 'file=@/tmp/shell.png' \
  https://staging2.praktiqu.com/api/v1/custom-fields/file-upload
```
Expected:
- `noauth=401` — and specifically **not 501**, which would mean the old build is still live.
- Happy path: `201` with `{"files":[{"name":"probe.png","mediaId":<n>,"url":"...kivicare-uploads/..."}]}`.
- PHP script: `422` with `type: about:blank`, and no new attachment created.

⚠️ **Throttle these calls.** Per the `staging-deploy-mechanics` memory the WAF 415 is a rate-limit/IP block, not a content-type block: hammering from one IP gets the IP blocked and then *every* request returns 415, which looks exactly like a multipart rejection and will send you chasing a bug that does not exist. If 415s appear suddenly across all requests, stop, wait for the block to clear, and resume slowly.

- [ ] **Step 8: Confirm a real consumer can read the id**

The point of the feature is that `resolveReportFile()` can turn the returned id into a URL. Using the `mediaId` from Step 7:

```bash
curl -4 -sS -X POST \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"patientId":<real-patient-id>,"name":"Upload smoke test","uploadReport":"<mediaId>"}' \
  https://staging2.praktiqu.com/api/v1/patient-medical-reports
```
Expected: `200` with the KiviCare envelope (`status: true`) and the created report carrying a resolvable `fileUrl`. This closes the loop the spec opens with: bytes in, media id out, existing consumer reads it.

- [ ] **Step 9: Record the outcome**

Update the spec's "PHP upload limits" section with the measured answer from Step 5, then commit:

```bash
git add docs/superpowers/specs/2026-07-15-file-upload-design.md
git commit -m "docs(upload): record measured PHP upload limits from staging"
```

---

### Task 6: Document the plugin route in openapi.yaml

**Files:**
- Modify: `openapi.yaml` (insert after the `/praktiqu/v1/jobs` block, before `/praktiqu/v1/users/lookup` at ~line 12486)

**Interfaces:**
- Consumes: the contract implemented in Task 4.
- Produces: documentation only.

Scope note: `openapi.yaml` documents **no** `/api/v1` paths — only `/kivicare/v1` (the legacy WP API) and `/praktiqu/v1` (this plugin). So the Next.js route does **not** belong in this file, but the new plugin route sits alongside its 6 siblings. The spec's follow-up pointing at `openapi.yaml:8723` was based on a misreading: that line is `GET /kivicare/v1/setting/custom-field/file-upload`, a legacy KiviCare endpoint unrelated to this work. Leave it alone.

- [ ] **Step 1: Add the path**

Insert, keeping the file's alphabetical ordering of `/praktiqu/v1` paths:

```yaml
  /praktiqu/v1/media:
    post:
      tags:
      - praktiqu
      summary: POST /praktiqu/v1/media
      description: >-
        Sideload one file into the WordPress media library and return its
        attachment id. Service-to-service only. Files land in a flat
        kivicare-* subfolder chosen by `context`.
      operationId: post_praktiqu_v1_media
      responses:
        '200':
          description: Attachment created
          content:
            application/json:
              schema:
                type: object
                properties:
                  mediaId:
                    type: integer
                    description: WordPress attachment ID
                  url:
                    type: string
                  name:
                    type: string
                required:
                - mediaId
                - url
                - name
        '400':
          $ref: '#/components/responses/Error'
        '401':
          $ref: '#/components/responses/Error'
        '403':
          $ref: '#/components/responses/Error'
        '413':
          $ref: '#/components/responses/Error'
      security:
      - serviceToken: []
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              properties:
                file:
                  type: string
                  format: binary
                context:
                  type: string
                  enum:
                  - medical-report
                  - custom-field
                  default: custom-field
              required:
              - file
```

- [ ] **Step 2: Verify the YAML still parses**

Run: `npx js-yaml openapi.yaml > /dev/null && echo OK`
Expected: `OK`. If `js-yaml` is unavailable, use `python3 -c "import yaml,sys; yaml.safe_load(open('openapi.yaml')); print('OK')"`.

- [ ] **Step 3: Commit**

```bash
git add openapi.yaml
git commit -m "docs(api): document POST /praktiqu/v1/media"
```

---

## Done when

- `npx vitest run tests/uploads/` is green.
- A real authenticated multipart POST to staging returns `201` with a numeric `mediaId` whose URL serves the file from a `kivicare-*` folder.
- A PHP script named `.png` returns `422` and creates nothing.
- The PHP upload-limit question from the spec has a measured answer recorded.
- `POST /api/v1/custom-fields/file-upload` never returns 501 again.
