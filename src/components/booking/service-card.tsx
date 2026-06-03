// src/components/booking/service-card.tsx
'use client';
import Link from 'next/link';

export interface ServiceCardData {
  id: string;
  name: string;
  description?: string | null;
  duration: number;
  price: any;
}

const ICONS: Record<string, string> = {
  konseling: '💬',
  asesmen: '🧪',
  anak: '👶',
  keluarga: '👥',
  pasangan: '💑',
  telekonsultasi: '🌐',
  konsultasi: '📋',
};

function pickIcon(name: string): string {
  const key = name.toLowerCase();
  for (const [k, icon] of Object.entries(ICONS)) {
    if (key.includes(k)) return icon;
  }
  return '✨';
}

function formatPrice(price: any): string {
  const num = typeof price === 'string' ? parseFloat(price) : Number(price);
  if (Number.isNaN(num)) return '—';
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(num);
}

export function ServiceCard({ service, professionalId }: { service: ServiceCardData; professionalId: string }) {
  return (
    <Link
      href={`/book/${professionalId}/${service.id}`}
      className="card flex flex-col gap-3 transition-shadow hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-[#f6f2ff] text-2xl">
          {pickIcon(service.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[#1b1b24]">{service.name}</div>
          <div className="text-xs text-[#464555]">⏱ {service.duration} menit</div>
        </div>
      </div>
      {service.description && (
        <p className="line-clamp-3 text-sm text-[#464555]">{service.description}</p>
      )}
      <div className="mt-auto flex items-center justify-between border-t border-[#e4e1ee] pt-3">
        <div className="text-base font-semibold text-[#3625cd]">{formatPrice(service.price)}</div>
        <span className="text-sm font-semibold text-[#3625cd]">Pilih →</span>
      </div>
    </Link>
  );
}