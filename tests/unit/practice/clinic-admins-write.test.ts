import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/wp-endpoint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wp-endpoint')>()),
  wpRequestJson: vi.fn(),
}));

import { WpEndpointError, wpRequestJson } from '@/lib/wp-endpoint';
import { createClinicAdminViaPlugin } from '@/repositories/wp/clinic-admins.write';

const input = { name: 'Dewi Lestari', email: 'dewi@contoh.id', clinicId: 57 };

describe('createClinicAdminViaPlugin', () => {
  beforeEach(() => {
    vi.mocked(wpRequestJson).mockReset();
  });

  it('posts name, email and clinic_id and maps the reply', async () => {
    vi.mocked(wpRequestJson).mockResolvedValue({ id: 912, email: 'dewi@contoh.id', username: 'dewi', clinic_id: 57, email_sent: true });

    await expect(createClinicAdminViaPlugin(input)).resolves.toEqual({ id: 912, email: 'dewi@contoh.id', clinicId: 57, emailSent: true });
    expect(wpRequestJson).toHaveBeenCalledWith('/clinic-admins', {
      method: 'POST',
      body: { name: 'Dewi Lestari', email: 'dewi@contoh.id', clinic_id: 57 },
    });
  });

  it('reads anything but email_sent=true as false', async () => {
    vi.mocked(wpRequestJson).mockResolvedValue({ id: 912, email: 'dewi@contoh.id', username: 'dewi', clinic_id: 57 });
    expect((await createClinicAdminViaPlugin(input)).emailSent).toBe(false);
  });

  it.each([null, {}, { id: 0 }, { id: '912' }, { id: Number.NaN }])('502s a reply without a usable id: %j', async (reply) => {
    vi.mocked(wpRequestJson).mockResolvedValue(reply);
    const err = await createClinicAdminViaPlugin(input).catch((e) => e);
    expect(err).toBeInstanceOf(WpEndpointError);
    expect(err.status).toBe(502);
  });

  it('lets a plugin error through unchanged', async () => {
    const taken = new WpEndpointError('/clinic-admins failed 409: That email is already registered.', 409, 'praktiqu_email_taken');
    vi.mocked(wpRequestJson).mockRejectedValue(taken);
    await expect(createClinicAdminViaPlugin(input)).rejects.toBe(taken);
  });
});
