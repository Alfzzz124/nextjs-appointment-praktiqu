'use client';
// src/app/(public)/error.tsx
// Route-group error boundary for every public page (landing, book/*, consent).
//
// Deliberately NOT wrapped in WizardLayout: WizardLayout renders the booking
// step indicator, and a step indicator on a page that just crashed would
// misleadingly suggest the wizard is still progressing normally. WizardLayout
// also requires a `currentStep`, which an arbitrary caught error has no
// correct value for (this boundary covers the whole (public) group, not just
// the booking wizard). A minimal, self-contained card keeps the message
// honest instead of borrowing wizard chrome that doesn't fit.
import { useEffect } from 'react';

export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Matches this codebase's convention of bracket-tagged console.error
    // calls (see src/app/(public)/book/page.tsx and friends). The DB-backed
    // logger in src/lib/logging.ts is server-only (imports prisma directly)
    // and cannot run from a client component.
    console.error('[public] unhandled error', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6 py-10">
      <div className="card w-full max-w-md text-center">
        <h1 className="text-lg font-bold text-[#1b1b24]">Ada yang tidak beres di sistem kami</h1>
        <p className="mt-2 text-sm text-[#464555]">
          Bukan Anda yang salah — ada gangguan sementara di server kami. Silakan coba lagi sebentar
          lagi. Jika masih gagal, hubungi kami dan sebutkan kode referensi di bawah ini.
        </p>
        {error.digest && (
          <p className="mt-3 text-xs text-[#777587]">
            Kode referensi: <span className="font-mono">{error.digest}</span>
          </p>
        )}
        <div className="mt-6 flex justify-center">
          <button type="button" onClick={() => reset()} className="btn-secondary">
            Coba lagi
          </button>
        </div>
      </div>
    </div>
  );
}
