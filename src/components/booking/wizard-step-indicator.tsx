// src/components/booking/wizard-step-indicator.tsx
'use client';

export interface BookingWizardStepsProps {
  currentStep: 1 | 2 | 3 | 4 | 5;
  steps?: string[];
}

const DEFAULT_STEPS = ['Profesional', 'Layanan', 'Jadwal', 'Data Diri', 'Konfirmasi'];

export function BookingWizardSteps({
  currentStep,
  steps = DEFAULT_STEPS,
}: BookingWizardStepsProps) {
  return (
    <ol className="flex items-center justify-between gap-2">
      {steps.map((label, idx) => {
        const stepNum = idx + 1;
        const isActive = stepNum === currentStep;
        const isComplete = stepNum < currentStep;
        return (
          <li key={label} className="flex flex-1 items-center">
            <div className="flex flex-col items-center">
              <div
                className={`grid h-9 w-9 place-items-center rounded-full text-sm font-semibold ${
                  isActive
                    ? 'bg-primary-700 text-white ring-4 ring-primary-700/20'
                    : isComplete
                    ? 'bg-primary-700 text-white'
                    : 'border-2 border-outline-variant text-outline'
                }`}
              >
                {isComplete ? '✓' : stepNum}
              </div>
              <span
                className={`mt-2 text-xs font-medium ${
                  isActive ? 'text-primary-700' : 'text-on-surface-variant'
                }`}
              >
                {label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div
                className={`mx-2 h-0.5 flex-1 ${
                  stepNum < currentStep ? 'bg-primary-700' : 'bg-surface-container-high'
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
