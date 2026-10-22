import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/wp-endpoint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wp-endpoint')>()),
  wpRequestJson: vi.fn(),
}));

import { wpRequestJson } from '@/lib/wp-endpoint';
import { createPatient } from '@/repositories/wp/patients.write';

const PLUGIN_REPLY = {
  id: 1032,
  email: 'dao@contoh.id',
  username: 'dao',
  first_name: 'Dao',
  last_name: '',
  contact_number: '0812345678',
  patient_unique_id: null,
};

beforeEach(() => {
  vi.mocked(wpRequestJson).mockReset().mockResolvedValue(PLUGIN_REPLY);
});

describe('createPatient — adoptExisting', () => {
  it('sends adopt_existing to the plugin when asked', async () => {
    await createPatient({ email: 'dao@contoh.id', firstName: 'Dao', adoptExisting: true });

    const [path, init] = vi.mocked(wpRequestJson).mock.calls[0];
    expect(path).toBe('/patients');
    expect((init as { body: Record<string, unknown> }).body).toMatchObject({ adopt_existing: true });
  });

  // Every other caller (staff "add client", registration) keeps the plain 409.
  it('omits it otherwise', async () => {
    await createPatient({ email: 'dao@contoh.id', firstName: 'Dao' });

    const [, init] = vi.mocked(wpRequestJson).mock.calls[0];
    expect((init as { body: Record<string, unknown> }).body).not.toHaveProperty('adopt_existing');
  });
});
