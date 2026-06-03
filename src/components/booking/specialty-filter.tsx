// src/components/booking/specialty-filter.tsx
'use client';
import { useRouter, useSearchParams } from 'next/navigation';

const SPECIALTIES = [
  'Anxiety',
  'Depresi',
  'Trauma',
  'Relationship',
  'Anak',
  'Remaja',
  'Keluarga',
  'Konseling',
  'Asesmen',
];

export function SpecialtyFilter({ active }: { active?: string }) {
  const router = useRouter();
  const params = useSearchParams();

  function setSpecialty(value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set('specialty', value);
    else next.delete('specialty');
    router.push(`/book?${next.toString()}`);
  }

  return (
    <div className="mb-6 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => setSpecialty(null)}
        className={active ? 'chip' : 'chip-active'}
      >
        Semua
      </button>
      {SPECIALTIES.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => setSpecialty(s)}
          className={active === s ? 'chip-active' : 'chip'}
        >
          {s}
        </button>
      ))}
    </div>
  );
}