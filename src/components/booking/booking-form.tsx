// src/components/booking/booking-form.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface BookingFormProps {
  professionalId: string;
  serviceId: string;
  holdKey: string;
  date: string;
  startTime: string;
  endTime: string;
}

export function BookingForm(props: BookingFormProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim() || !mobile.trim()) {
      return setError('Nama, email, dan nomor HP wajib diisi');
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/public/booking', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          professionalId: props.professionalId,
          serviceId: props.serviceId,
          date: props.date,
          startTime: props.startTime,
          clientName: name,
          clientEmail: email,
          clientMobile: mobile,
          notes: notes || undefined,
          holdKey: props.holdKey,
        }),
      });
      const data = await res.json();
      if (res.status === 410) {
        setError('Slot hold sudah berakhir. Silakan pilih jadwal lain.');
        return;
      }
      if (res.status === 409) {
        setError('Slot sudah diambil orang lain. Silakan pilih jadwal lain.');
        return;
      }
      if (res.status === 403) {
        setError('Akun Anda tidak aktif. Hubungi klinik.');
        return;
      }
      if (!res.ok) {
        setError(data.title ?? 'Gagal membuat booking');
        return;
      }
      const params = new URLSearchParams({
        id: data.id,
        professional: data.professionalName ?? '',
        service: data.service ?? '',
        date: props.date,
        startTime: props.startTime,
      });
      router.push(`/book/confirmation?${params.toString()}`);
    } catch (e: any) {
      setError(e?.message ?? 'Terjadi kesalahan');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4">
      <div>
        <label className="label-base">Nama Lengkap *</label>
        <input
          className="input-base"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="label-base">Email *</label>
        <input
          type="email"
          className="input-base"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="label-base">Nomor HP / WhatsApp *</label>
        <input
          type="tel"
          className="input-base"
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="label-base">Catatan (opsional)</label>
        <textarea
          className="input-base"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Hal yang ingin Anda sampaikan kepada profesional"
        />
      </div>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex items-start gap-2 rounded-lg bg-[#f6f2ff] p-3 text-xs text-[#3625cd]">
        <span>🔒</span>
        <p>
          Dengan melanjutkan, Anda menyetujui pembuatan akun otomatis di PraktiQU
          dan menerima email konfirmasi booking.
        </p>
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="btn-primary w-full py-3 text-base"
      >
        {submitting ? 'Memproses…' : 'Konfirmasi Booking'}
      </button>
    </form>
  );
}