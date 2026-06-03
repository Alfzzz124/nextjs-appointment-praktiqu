// src/components/booking/hold-countdown.tsx
'use client';
import { useEffect, useState } from 'react';

export function HoldCountdown({ holdKey, startTime, endTime }: { holdKey: string; startTime: string; endTime: string }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    let active = true;
    async function tick() {
      try {
        const res = await fetch(`/api/v1/public/booking/hold?key=${encodeURIComponent(holdKey)}`);
        if (!res.ok) { if (active) setExpired(true); return; }
        const data = await res.json();
        if (active) {
          setRemaining(data.remainingSec);
          if (data.remainingSec <= 0) setExpired(true);
        }
      } catch { if (active) setExpired(true); }
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => { active = false; clearInterval(id); };
  }, [holdKey]);

  if (expired) {
    return (
      <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <strong>Slot hold berakhir.</strong> Silakan pilih jadwal lain.
      </div>
    );
  }
  if (remaining == null) return null;

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const warning = remaining < 5 * 60;

  return (
    <div className={`mb-6 rounded-lg p-3 text-sm ${
      warning
        ? 'border border-amber-300 bg-amber-50 text-amber-800'
        : 'border border-surface-container-high bg-surface-container-low text-primary-700'
    }`}>
      <span className="font-semibold">Slot di-hold untuk Anda:</span>{' '}
      {startTime}{endTime ? `–${endTime}` : ''} • Sisa waktu{' '}
      <strong>
        {minutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}
      </strong>
      {warning && <span className="ml-1">⚠️ Segera selesaikan booking</span>}
    </div>
  );
}
