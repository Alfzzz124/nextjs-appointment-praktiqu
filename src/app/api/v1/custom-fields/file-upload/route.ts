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
    // `result.ok === false` (not `!result.ok`) is required for correct
    // discriminated-union narrowing under this project's
    // `strictNullChecks: false` tsconfig — see route.ts self-review notes.
    if (result.ok === false) {
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
