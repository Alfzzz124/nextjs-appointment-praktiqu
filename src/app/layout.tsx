// src/app/layout.tsx
// Root layout for the entire PraktiQU app.
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'PraktiQU - Klinik Psikologi Terpercaya',
    template: '%s | PraktiQU',
  },
  description:
    'Platform manajemen klinik psikologi dan konseling. Booking sesi dengan profesional terpercaya, kelola catatan, dan pantau perkembangan klien.',
  keywords: [
    'klinik psikologi',
    'konseling',
    'booking online',
    'psikolog',
    'psikiater',
    'manajemen klinik',
  ],
  authors: [{ name: 'PraktiQU' }],
  openGraph: {
    title: 'PraktiQU - Klinik Psikologi Terpercaya',
    description: 'Booking sesi dengan psikolog dan psikiater terpercaya',
    type: 'website',
    locale: 'id_ID',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="bg-surface text-on-surface antialiased">
      <body className="min-h-screen font-sans">
        {children}
      </body>
    </html>
  );
}