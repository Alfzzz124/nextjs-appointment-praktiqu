'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './sidebar';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Get page title from pathname
  const getPageTitle = () => {
    if (pathname === '/admin' || pathname === '/admin/sessions') return 'Dashboard';
    if (pathname.startsWith('/admin/clients')) return 'Clients';
    if (pathname.startsWith('/admin/professionals')) return 'Professionals';
    if (pathname.startsWith('/billing')) return 'Billing';
    if (pathname.startsWith('/intervention-plans')) return 'Intervention Plans';
    if (pathname.startsWith('/consent-forms')) return 'Consent Forms';
    if (pathname.startsWith('/practice/settings')) return 'Practice Settings';
    if (pathname.startsWith('/settings/custom-fields')) return 'Custom Fields';
    if (pathname.startsWith('/settings/email-templates')) return 'Email Templates';
    if (pathname.startsWith('/settings/notes-templates')) return 'Notes Templates';
    return 'Dashboard';
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-gray-200 bg-white px-4 lg:px-6">
          {/* Mobile menu button */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 text-gray-500 hover:text-gray-700"
          >
            <span className="text-xl">☰</span>
          </button>

          {/* Page title */}
          <h1 className="text-lg font-semibold text-gray-900 lg:text-xl">
            {getPageTitle()}
          </h1>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Actions */}
          <div className="flex items-center gap-3">
            {/* Notifications */}
            <button className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg">
              <span className="text-lg">🔔</span>
              <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full" />
            </button>

            {/* Clinic selector */}
            <button className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg border border-gray-200">
              <span>🏥</span>
              <span className="hidden sm:inline">PraktiQU Clinic</span>
              <span>▾</span>
            </button>

            {/* User menu */}
            <button className="flex items-center gap-2 p-1 hover:bg-gray-100 rounded-lg">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary-700 to-primary-500 flex items-center justify-center text-white text-sm font-semibold">
                A
              </div>
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
