// src/components/booking/slot-picker.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface SlotPickerProps {
  professionalId: string;
  serviceId: string;
  days: Array<{
    date: string;
    slots: Array<{ startTime: string; endTime: string; startUtc: string }>;
  }>;
}

const DAYS_ID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

export function SlotPicker({ professionalId, serviceId, days }: SlotPickerProps) {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState<string | null>(
    days.find((d) => d.slots.length > 0)?.date ?? null,
  );
  const [selectedSlot, setSelectedSlot] = useState<{ startTime: string; endTime: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeDay = days.find((d) => d.date === selectedDate);

  async function handleContinue() {
    if (!selectedSlot || !selectedDate) return;
    setCreating(true);
    setError(null);
    try {
      const holdRes = await fetch('/api/v1/public/booking/hold', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          professionalId,
          serviceId,
          date: selectedDate,
          startTime: selectedSlot.startTime,
        }),
      });
      if (!holdRes.ok) {
        const data = await holdRes.json();
        throw new Error(data.title ?? 'Gagal membuat slot hold');
      }
      const { holdKey } = await holdRes.json();
      const params = new URLSearchParams({
        holdKey,
        date: selectedDate,
        startTime: selectedSlot.startTime,
        endTime: selectedSlot.endTime,
      });
      router.push(`/book/${professionalId}/${serviceId}/confirm?${params.toString()}`);
    } catch (e: any) {
      setError(e?.message ?? 'Terjadi kesalahan');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      {/* Date picker */}
      <div className="mb-6 overflow-x-auto">
        <div className="flex gap-2">
          {days.map((d) => {
            const dt = new Date(d.date);
            const hasSlots = d.slots.length > 0;
            const isActive = selectedDate === d.date;
            return (
              <button
                key={d.date}
                onClick={() => {
                  setSelectedDate(d.date);
                  setSelectedSlot(null);
                }}
                disabled={!hasSlots}
                className={`flex min-w-[68px] flex-col items-center rounded-lg border px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'border-[#3625cd] bg-[#3625cd] text-white'
                    : hasSlots
                    ? 'border-[#c7c4d8] bg-white text-[#1b1b24] hover:border-[#3625cd]'
                    : 'border-[#e4e1ee] bg-[#f6f2ff] text-[#777587] opacity-50'
                }`}
              >
                <span className="text-xs font-medium uppercase">{DAYS_ID[dt.getDay()]}</span>
                <span className="text-lg font-bold">{dt.getDate()}</span>
                <span className="text-[10px]">
                  {dt.toLocaleDateString('id-ID', { month: 'short' })}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Slot grid */}
      {activeDay && activeDay.slots.length > 0 ? (
        <>
          <h3 className="mb-3 text-sm font-semibold text-[#1b1b24]">
            Slot tersedia pada{' '}
            {new Date(activeDay.date).toLocaleDateString('id-ID', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {activeDay.slots.map((slot) => {
              const isActive = selectedSlot?.startTime === slot.startTime;
              return (
                <button
                  key={slot.startTime}
                  onClick={() => setSelectedSlot(slot)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'border-[#3625cd] bg-[#3625cd] text-white'
                      : 'border-[#c7c4d8] bg-white text-[#1b1b24] hover:border-[#3625cd]'
                  }`}
                >
                  {slot.startTime}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="rounded-lg bg-[#f6f2ff] p-4 text-center text-sm text-[#464555]">
          Tidak ada slot tersedia untuk tanggal ini.
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-8 flex justify-end">
        <button
          onClick={handleContinue}
          disabled={!selectedSlot || creating}
          className="btn-primary"
        >
          {creating ? 'Menyiapkan…' : 'Lanjut →'}
        </button>
      </div>
    </div>
  );
}