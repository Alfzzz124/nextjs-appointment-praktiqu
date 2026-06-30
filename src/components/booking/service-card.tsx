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

function parseDescription(desc: string | null | undefined): string | null {
  if (!desc) return null;
  try {
    if (desc.trim().startsWith('{')) {
      const parsed = JSON.parse(desc);
      if (parsed && parsed.label) {
        return parsed.label;
      }
    }
  } catch (e) {
    // Ignore and fallback to returning the original string
  }
  return desc;
}

export function ServiceCard({ service, professionalId }: { service: ServiceCardData; professionalId: string }) {
  return (
    <Link
      href={`/book/${professionalId}/${service.id}`}
      className="card flex flex-col gap-3 transition-shadow hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-surface-container-low text-2xl">
          {pickIcon(service.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-on-surface">{service.name}</div>
          <div className="text-xs text-on-surface-variant">⏱ {service.duration} menit</div>
        </div>
      </div>
      {service.description && (
        <p className="line-clamp-3 text-sm text-on-surface-variant">
          {parseDescription(service.description)}
        </p>
      )}
      <div className="mt-auto flex items-center justify-between border-t border-surface-container-high pt-3">
        <div className="text-base font-semibold text-primary-700">{formatPrice(service.price)}</div>
        <span className="text-sm font-semibold text-primary-700">Pilih →</span>
      </div>
    </Link>
  );
}
