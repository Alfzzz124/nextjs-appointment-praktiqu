/**
 * The FE-vouched client IP — trusted only with the shared forwarder key.
 * See src/lib/client-ip.ts for why a secret rather than an X-Forwarded-For position.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_IP_HEADER, FORWARDER_KEY_HEADER, clientIpOrNull, getClientIp } from '@/lib/client-ip';

const SECRET = 'a-forwarder-secret-long-enough';
const FE_HOST = '2a02:4780:6:1965:0:24b3:8603:1';

function headers(h: Record<string, string>): Headers {
  return new Headers(h);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getClientIp', () => {
  it('uses the vouched IP when the forwarder key matches', () => {
    vi.stubEnv('FE_FORWARDER_SECRET', SECRET);
    const h = headers({
      'x-forwarded-for': FE_HOST,
      [CLIENT_IP_HEADER]: '203.0.113.7',
      [FORWARDER_KEY_HEADER]: SECRET,
    });
    expect(getClientIp(h)).toBe('203.0.113.7');
  });

  it('accepts an IPv6 client', () => {
    vi.stubEnv('FE_FORWARDER_SECRET', SECRET);
    const h = headers({ [CLIENT_IP_HEADER]: '2001:db8::1', [FORWARDER_KEY_HEADER]: SECRET });
    expect(getClientIp(h)).toBe('2001:db8::1');
  });

  it('ignores the vouched IP when the key is wrong — anyone could otherwise pick their own', () => {
    vi.stubEnv('FE_FORWARDER_SECRET', SECRET);
    const h = headers({
      'x-forwarded-for': FE_HOST,
      [CLIENT_IP_HEADER]: '203.0.113.7',
      [FORWARDER_KEY_HEADER]: 'a-forwarder-secret-long-enougX',
    });
    expect(getClientIp(h)).toBe(FE_HOST);
  });

  it('ignores the vouched IP when the key is missing', () => {
    vi.stubEnv('FE_FORWARDER_SECRET', SECRET);
    const h = headers({ 'x-forwarded-for': FE_HOST, [CLIENT_IP_HEADER]: '203.0.113.7' });
    expect(getClientIp(h)).toBe(FE_HOST);
  });

  it('ignores the vouched IP when no secret is configured, even if the caller sends an empty key', () => {
    vi.stubEnv('FE_FORWARDER_SECRET', '');
    const h = headers({ 'x-forwarded-for': FE_HOST, [CLIENT_IP_HEADER]: '203.0.113.7', [FORWARDER_KEY_HEADER]: '' });
    expect(getClientIp(h)).toBe(FE_HOST);
  });

  it('treats a too-short secret as unset', () => {
    vi.stubEnv('FE_FORWARDER_SECRET', 'short');
    const h = headers({ 'x-forwarded-for': FE_HOST, [CLIENT_IP_HEADER]: '203.0.113.7', [FORWARDER_KEY_HEADER]: 'short' });
    expect(getClientIp(h)).toBe(FE_HOST);
  });

  it('rejects a vouched value that is not an IP address', () => {
    vi.stubEnv('FE_FORWARDER_SECRET', SECRET);
    const h = headers({
      'x-forwarded-for': FE_HOST,
      [CLIENT_IP_HEADER]: '203.0.113.7, 10.0.0.1',
      [FORWARDER_KEY_HEADER]: SECRET,
    });
    expect(getClientIp(h)).toBe(FE_HOST);
  });

  it('keeps the old fallbacks: first X-Forwarded-For entry, then X-Real-IP, then 0.0.0.0', () => {
    expect(getClientIp(headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).toBe('198.51.100.1');
    expect(getClientIp(headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(getClientIp(headers({}))).toBe('0.0.0.0');
  });

  it('reads a plain header record as well as Headers', () => {
    vi.stubEnv('FE_FORWARDER_SECRET', SECRET);
    expect(getClientIp({ [CLIENT_IP_HEADER]: '203.0.113.9', [FORWARDER_KEY_HEADER]: SECRET })).toBe('203.0.113.9');
  });
});

describe('clientIpOrNull', () => {
  it('returns null when nothing identifies the client', () => {
    expect(clientIpOrNull(headers({}))).toBeNull();
  });
});
