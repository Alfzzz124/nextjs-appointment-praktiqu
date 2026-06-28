import { describe, it, expect } from 'vitest';
import { kcOk, kcFail, KcError, kcHandle } from '@/lib/kc-response';
import { toNum, toMoney } from '@/lib/kc-num';

describe('kc-response', () => {
  it('kcOk wraps data with status true', async () => {
    const res = kcOk({ id: 1 }, 'done');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: true, message: 'done', data: { id: 1 } });
  });

  it('kcFail sets status false and http status', async () => {
    const res = kcFail('nope', 403);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ status: false, message: 'nope', data: null });
  });

  it('kcHandle converts KcError to envelope', async () => {
    const res = await kcHandle(async () => { throw new KcError('bad', 409); });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe('bad');
  });

  it('toNum parses varchar amounts', () => {
    expect(toNum('12.50')).toBe(12.5);
    expect(toNum('')).toBe(0);
    expect(toMoney(0.1 + 0.2)).toBe(0.3);
  });
});
