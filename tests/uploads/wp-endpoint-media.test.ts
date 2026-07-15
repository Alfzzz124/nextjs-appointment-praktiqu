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
