// src/app/(public)/book/layout.tsx
// Public booking wizard layout.
import { WizardLayout } from '@/components/booking/wizard-layout';

// STAGING BANNER - Remove this component when going to production
function StagingBanner() {
  return (
    <div className="bg-amber-100 border-b border-amber-300 px-4 py-2 text-center text-sm">
      <span className="font-semibold text-amber-800">⚠️ STAGING ENVIRONMENT</span>
      <span className="ml-2 text-amber-700">
        Data tidak disimpan secara permanen. Jangan gunakan untuk booking asli.
      </span>
    </div>
  );
}

export default function BookLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StagingBanner />
      {children}
    </>
  );
}