/**
 * Practice settings page.
 *
 * Route: /practice/settings
 * Accessible: Clinic admin / Super admin only.
 *
 * Fetches the first practice (in v1 there's one clinic per PraktiQU instance)
 * and renders the SettingsForm component.
 */
import { getPractice } from '@/services/practice/service';
import { SettingsForm } from '@/components/practice/settings-form';
import { logging } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * Load the first practice in the system. In v1 the system has a single
 * clinic, so this returns the primary practice without requiring an ID in the URL.
 */
async function getCurrentPracticeId(): Promise<string> {
  // List all practices (limit 1) to find the default clinic.
  // In a multi-tenant future this would come from the session.
  const { prisma } = await import('@/lib/db');
  const rows = await prisma.clinic.findMany({
    orderBy: { createdAt: 'asc' },
    take: 1,
    select: { id: true },
  });
  if (rows.length === 0) {
    throw new Error('No practice found. Ensure at least one clinic exists in the database.');
  }
  return rows[0]!.id;
}

export default async function PracticeSettingsPage() {
  try {
    const practiceId = await getCurrentPracticeId();
    const practice = await getPractice(practiceId);

    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Practice Settings</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your practice profile, contact info, timezone, and branding.
          </p>
        </div>
        <SettingsForm
          practice={practice}
          onSaved={(updated) => {
            // Invalidate the page cache on save so the next load shows fresh data
            void logging.activity('practice.settings.saved', { resource: 'practice', resourceId: updated.id });
          }}
          onError={(msg) => {
            console.error('[practice/settings] save error:', msg);
          }}
        />
      </div>
    );
  } catch (err) {
    await logging.error('PracticeSettingsPage failed', err, { path: '/practice/settings' });
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-800">
          Failed to load practice settings. Please try again later.
        </div>
      </div>
    );
  }
}