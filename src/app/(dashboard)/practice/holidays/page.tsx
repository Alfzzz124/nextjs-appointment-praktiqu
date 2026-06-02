/**
 * Practice holidays page.
 *
 * Route: /practice/holidays
 * Accessible: Clinic admin / Super admin only.
 *
 * Lists and manages holidays for the current practice.
 */
import { getPractice, listHolidays } from '@/services/practice/service';
import { Holidays } from '@/components/practice/holidays';
import { logging } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * Load the first practice in the system. In v1 the system has a single
 * clinic, so this returns the primary practice without requiring an ID in the URL.
 */
async function getCurrentPracticeId(): Promise<string> {
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

export default async function PracticeHolidaysPage() {
  try {
    const practiceId = await getCurrentPracticeId();
    const practice = await getPractice(practiceId);

    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Holiday Calendar</h1>
          <p className="mt-1 text-sm text-gray-500">
            Add public holidays or practice closures. Closed days are blocked from booking.
          </p>
        </div>
        <Holidays
          practiceId={practice.id}
          onError={(msg) => {
            console.error('[practice/holidays]', msg);
          }}
        />
      </div>
    );
  } catch (err) {
    await logging.error('PracticeHolidaysPage failed', err, { path: '/practice/holidays' });
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-800">
          Failed to load holidays. Please try again later.
        </div>
      </div>
    );
  }
}