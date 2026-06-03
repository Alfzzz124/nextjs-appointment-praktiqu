// src/components/booking/confirmation.tsx
'use client';
import Link from 'next/link';

export interface ConfirmationProps {
  bookingId: string;
  professionalName: string;
  serviceName: string;
  date: string;
  startTime: string;
}

function generateIcs(data: ConfirmationProps): string {
  const start = new Date(`${data.date}T${data.startTime}:00`);
  const end = new Date(start.getTime() + 60 * 60_000);
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PraktiQU//Booking//ID',
    'BEGIN:VEVENT',
    `UID:${data.bookingId}@praktiqu`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${data.serviceName} dengan ${data.professionalName}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export function Confirmation(props: ConfirmationProps) {
  function downloadIcs() {
    const blob = new Blob([generateIcs(props)], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `praktiqu-${props.bookingId}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function googleCalendar() {
    const start = new Date(`${props.date}T${props.startTime}:00`)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
    const end = new Date(new Date(`${props.date}T${props.startTime}:00`).getTime() + 60 * 60_000)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
      `${props.serviceName} - PraktiQU`,
    )}&dates=${start}/${end}&details=${encodeURIComponent('Sesi konseling Anda di PraktiQU')}`;
    window.open(url, '_blank');
  }

  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#f0ecf9] text-3xl">
        ✓
      </div>
      <h1 className="mt-6 text-3xl font-bold text-[#1b1b24]">Booking Berhasil!</h1>
      <p className="mt-2 text-sm text-[#464555]">
        Sesi Anda telah dikonfirmasi. Kami telah mengirim detailnya ke email Anda.
      </p>

      <div className="card mt-8 text-left">
        <h3 className="text-sm font-semibold text-[#1b1b24]">Detail Sesi</h3>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between border-b border-[#e4e1ee] pb-2">
            <dt className="text-[#777587]">ID Booking</dt>
            <dd className="font-mono text-xs text-[#1b1b24]">{props.bookingId}</dd>
          </div>
          <div className="flex justify-between border-b border-[#e4e1ee] pb-2">
            <dt className="text-[#777587]">Status</dt>
            <dd>
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                PENDING
              </span>
            </dd>
          </div>
          <div className="flex justify-between border-b border-[#e4e1ee] pb-2">
            <dt className="text-[#777587]">Layanan</dt>
            <dd className="font-medium text-[#1b1b24]">{props.serviceName}</dd>
          </div>
          <div className="flex justify-between border-b border-[#e4e1ee] pb-2">
            <dt className="text-[#777587]">Profesional</dt>
            <dd className="font-medium text-[#1b1b24]">{props.professionalName}</dd>
          </div>
          <div className="flex justify-between border-b border-[#e4e1ee] pb-2">
            <dt className="text-[#777587]">Tanggal</dt>
            <dd className="font-medium text-[#1b1b24]">
              {new Date(props.date).toLocaleDateString('id-ID', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[#777587]">Waktu</dt>
            <dd className="font-medium text-[#1b1b24]">{props.startTime} WIB</dd>
          </div>
        </dl>
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button onClick={downloadIcs} className="btn-secondary">
          📅 Download .ics
        </button>
        <button onClick={googleCalendar} className="btn-secondary">
          📆 Google Calendar
        </button>
      </div>

      <div className="mt-8 rounded-lg bg-[#f6f2ff] p-4 text-left text-sm">
        <h4 className="font-semibold text-[#3625cd]">Apa selanjutnya?</h4>
        <ul className="mt-2 space-y-1 text-[#464555]">
          <li>✓ Profesional akan menerima notifikasi dan mengkonfirmasi dalam 1×24 jam</li>
          <li>✓ Anda akan menerima reminder H-1 via email & WhatsApp</li>
          <li>✓ Pembayaran dilakukan di klinik sebelum sesi</li>
        </ul>
      </div>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn-primary">
          Kembali ke Beranda
        </Link>
        <Link href="/login" className="btn-secondary">
          Masuk ke Dashboard
        </Link>
      </div>
    </div>
  );
}