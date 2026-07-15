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
  // See src/lib/wp-endpoint.ts for why the re-wrap is needed: plain `Uint8Array`
  // is `Uint8Array<ArrayBufferLike>`, but `BlobPart` requires `ArrayBufferView<ArrayBuffer>`.
  return new File([new Uint8Array(bytes)], name, { type });
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
