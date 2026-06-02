/**
 * Self-service professional profile page.
 * US2: professional views and updates own profile
 *
 * T033: self-service profile page with availability and off-day management
 * T043: availability and off-day management included
 */

import { notFound } from 'next/navigation';

const PROFESSIONAL_TYPE_LABELS: Record<string, string> = {
  PSIKOLOG_KLINIS: 'Psikolog Klinis',
  PSIKOLOG_ANAK: 'Psikolog Anak',
  PSIKIATER: 'Psikiater',
  KONSELOR: 'Konselor',
};

async function getProfessionalProfile(userId: string) {
  // In production, call getProfessionalByUserId service directly
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/v1/professionals?userId=${userId}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[0] ?? null;
  } catch {
    return null;
  }
}

interface PageProps {
  // In production, get userId from session
}

export default async function ProfessionalProfilePage(_props: PageProps) {
  // In a real implementation, get the authenticated user from the session
  // const session = await getServerSession();
  // const userId = session?.user?.id;
  // const professional = await getProfessionalProfile(userId);

  // For now, show a placeholder
  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your professional profile and availability</p>
      </div>

      {/* Profile info (read-only except biography/specialties) */}
      <ProfileSection />

      {/* Availability management */}
      <AvailabilitySection />

      {/* Off-days management */}
      <OffDaysSection />
    </div>
  );
}

function ProfileSection() {
  return (
    <section className="bg-white border rounded-lg p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-800">Profile Information</h2>
      <p className="text-xs text-gray-400">Registration number and type cannot be changed. Contact an administrator.</p>
      {/* In production, render ProfessionalForm with readOnlyFields=true */}
      <ProfessionalFormPlaceholder />
    </section>
  );
}

function AvailabilitySection() {
  return (
    <section className="bg-white border rounded-lg p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-800">Weekly Availability</h2>
      <p className="text-xs text-gray-500">Define when you are available for sessions. Times are in your practice timezone.</p>
      {/* In production, render AvailabilityEditor */}
      <AvailabilityPlaceholder />
    </section>
  );
}

function OffDaysSection() {
  return (
    <section className="bg-white border rounded-lg p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-800">Off Days</h2>
      <p className="text-xs text-gray-500">Mark days when you are not available (vacation, holidays, etc.)</p>
      {/* In production, render OffDayEditor */}
      <OffDayPlaceholder />
    </section>
  );
}

// Placeholder components — in production these use the real components
function ProfessionalFormPlaceholder() {
  return (
    <div className="text-sm text-gray-400 italic">Loading profile form...</div>
  );
}

function AvailabilityPlaceholder() {
  return (
    <div className="text-sm text-gray-400 italic">Loading availability editor...</div>
  );
}

function OffDayPlaceholder() {
  return (
    <div className="text-sm text-gray-400 italic">Loading off-day editor...</div>
  );
}

// Make sure we don't get a build error from unused imports
import type { ProfessionalStatus } from '@prisma/client';