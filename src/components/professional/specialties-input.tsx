'use client';

/**
 * Specialties multi-select/tag input component.
 * US2: self-service profile specialties input
 *
 * T034: specialties multi-select/tag input
 */

import { useState } from 'react';

interface SpecialtiesInputProps {
  initial?: string[];
  onChange?: (specialties: string[]) => void;
  readOnly?: boolean;
  maxItems?: number;
}

const COMMON_SPECIALTIES = [
  'Depresi',
  'Kecemasan',
  'Trauma & PTSD',
  'Anak & Remaja',
  'Pasangan',
  'Keluarga',
  'Gangguan Makan',
  'Kecanduan',
  'Kepribadian',
  'Schizophrenia',
];

export function SpecialtiesInput({
  initial = [],
  onChange,
  readOnly = false,
  maxItems = 20,
}: SpecialtiesInputProps) {
  const [specialties, setSpecialties] = useState<string[]>(initial);
  const [input, setInput] = useState('');
  const [suggestions] = useState<string[]>(COMMON_SPECIALTIES);

  function addSpecialty(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (specialties.includes(trimmed)) return;
    if (specialties.length >= maxItems) return;
    const updated = [...specialties, trimmed];
    setSpecialties(updated);
    onChange?.(updated);
    setInput('');
  }

  function removeSpecialty(s: string) {
    const updated = specialties.filter((x) => x !== s);
    setSpecialties(updated);
    onChange?.(updated);
  }

  const filteredSuggestions = suggestions.filter(
    (s) => s.toLowerCase().includes(input.toLowerCase()) && !specialties.includes(s),
  );

  return (
    <div className="space-y-2">
      {/* Tags display */}
      {specialties.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {specialties.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 px-2 py-1 rounded-full text-xs"
            >
              {s}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => removeSpecialty(s)}
                  className="hover:text-blue-900 font-bold"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Input */}
      {!readOnly && (
        <>
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addSpecialty(input);
                }
              }}
              placeholder="Add a specialty..."
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => addSpecialty(input)}
              disabled={!input.trim()}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Add
            </button>
          </div>

          {/* Suggestions */}
          {input && filteredSuggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {filteredSuggestions.slice(0, 5).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addSpecialty(s)}
                  className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 text-gray-600"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}