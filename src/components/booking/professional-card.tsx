// src/components/booking/professional-card.tsx
'use client';
import Link from 'next/link';

export interface ProfessionalCardData {
  id: string;
  fullName: string;
  professionalType?: string | null;
  biography?: string | null;
  specialties: string[];
  nextSlot?: string | null;
  nextDate?: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  PSIKOLOG_KLINIS: 'Psikolog Klinis',
  PSIKOLOG_ANAK: 'Psikolog Anak',
  PSIKIATER: 'Psikiater',
  KONSELOR: 'Konselor',
};

export function ProfessionalCard({ professional }: { professional: ProfessionalCardData }) {
  const initials = professional.fullName
    .split(' ')
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const typeLabel = professional.professionalType
    ? TYPE_LABELS[professional.professionalType] ?? professional.professionalType
    : '';

  return (
    <Link
      href={`/book/${professional.id}/service`}
      className="card flex flex-col gap-3 transition-shadow hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#3625cd] to-[#5046e5] text-lg font-semibold text-white">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-[#1b1b24]">{professional.fullName}</div>
          <div className="text-xs text-[#464555]">{typeLabel}</div>
        </div>
      </div>
      {professional.specialties.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {professional.specialties.slice(0, 3).map((s) => (
            <span key={s} className="chip">
              {s}
            </span>
          ))}
        </div>
      )}
      {professional.biography && (
        <p className="line-clamp-2 text-sm text-[#464555]">{professional.biography}</p>
      )}
      <div className="mt-auto flex items-center justify-between border-t border-[#e4e1ee] pt-3 text-sm">
        <div>
          <div className="text-xs text-[#777587]">Slot berikutnya</div>
          <div className="font-semibold text-[#1b1b24]">
            {professional.nextSlot && professional.nextDate
              ? `${professional.nextSlot} • ${new Date(professional.nextDate).toLocaleDateString('id-ID', {
                  day: 'numeric',
                  month: 'short',
                })}`
              : 'Belum tersedia'}
          </div>
        </div>
        <span className="text-sm font-semibold text-[#3625cd]">Pilih →</span>
      </div>
    </Link>
  );
}