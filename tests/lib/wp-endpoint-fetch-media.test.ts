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
  process.env.WORDPRESS_SERVICE_TOKEN = 'test-token';
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
    const fetchMock = vi.fn(async () =>
      new Response('not found', { status: 404 }));
    globalThis.fetch = fetchMock as any;

    const err: any = await fetchMedia(9).catch((e) => e);

    expect(err).toBeInstanceOf(WpEndpointError);
    expect(err.status).toBe(404);
    expect(err.message).toBe('Media fetch failed 404: not found');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws WpEndpointError when the response carries no body', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as any;

    const err: any = await fetchMedia(9).catch((e) => e);

    expect(err).toBeInstanceOf(WpEndpointError);
    expect(err.status).toBe(200);
    expect(err.message).toBe('Media fetch returned no body');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
