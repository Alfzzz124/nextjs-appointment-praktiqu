// src/components/booking/wizard-layout.tsx
'use client';
import Link from 'next/link';
import { BookingWizardSteps } from './wizard-step-indicator';

export interface WizardLayoutProps {
  currentStep: 1 | 2 | 3 | 4 | 5;
  children: React.ReactNode;
}

export function WizardLayout({ currentStep, children }: WizardLayoutProps) {
  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-surface-container-high bg-white">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold text-primary-700">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary-700 text-white">P</span>
            PraktiQU
          </Link>
          <Link href="/" className="text-sm text-on-surface-variant hover:text-primary-700">
            ← Kembali ke beranda
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-10">
          <BookingWizardSteps currentStep={currentStep} />
        </div>
        {children}
      </main>
    </div>
  );
}
