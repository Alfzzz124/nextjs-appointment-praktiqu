'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

interface NavItem {
  label: string;
  href: string;
  icon: string;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/admin', icon: '📊' },
  { label: 'Sessions', href: '/admin/sessions', icon: '📅' },
  { label: 'Clients', href: '/admin/clients', icon: '👥' },
  { label: 'Professionals', href: '/admin/professionals', icon: '👨‍⚕️' },
  { label: 'Billing', href: '/billing', icon: '💰' },
  { label: 'Intervention Plans', href: '/intervention-plans', icon: '📋' },
  { label: 'Consent Forms', href: '/consent-forms', icon: '📝' },
];

const SETTINGS_ITEMS: NavItem[] = [
  { label: 'Practice Settings', href: '/practice/settings', icon: '⚙️' },
  { label: 'Custom Fields', href: '/settings/custom-fields', icon: '🔧' },
  { label: 'Email Templates', href: '/settings/email-templates', icon: '📧' },
  { label: 'Notes Templates', href: '/settings/notes-templates', icon: '📄' },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isOpen = true, onClose }: SidebarProps) {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(true);

  const isActive = (href: string) => {
    if (href === '/admin') {
      return pathname === '/admin' || pathname === '/admin/sessions';
    }
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar - flex-shrink-0 untuk保证 sidebar tidak压缩 */}
      <aside
        className={`
          flex-shrink-0
          w-64 bg-white border-r border-gray-200
          flex flex-col
          fixed lg:static inset-y-0 left-0 z-50
          transform transition-transform duration-200 ease-in-out
          lg:transform-none
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-4 py-5 border-b border-gray-100">
          <Link href="/admin" className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary-700 text-white font-bold text-lg">
              P
            </span>
            <span className="text-lg font-bold text-gray-900">PraktiQU</span>
          </Link>
          <button
            onClick={onClose}
            className="lg:hidden p-2 text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                transition-colors
                ${
                  isActive(item.href)
                    ? 'bg-primary-50 text-primary-700 border-l-4 border-primary-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }
              `}
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
              {item.badge && (
                <span className="ml-auto bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
                  {item.badge}
                </span>
              )}
            </Link>
          ))}

          {/* Settings section */}
          <div className="pt-4 mt-4 border-t border-gray-100">
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              <span>⚙️ Settings</span>
              <span className={`transform transition-transform ${settingsOpen ? 'rotate-180' : ''}`}>
                ▼
              </span>
            </button>
            {settingsOpen && (
              <div className="mt-1 space-y-1">
                {SETTINGS_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={`
                      flex items-center gap-3 pl-8 pr-3 py-2 rounded-lg text-sm
                      transition-colors
                      ${
                        isActive(item.href)
                          ? 'bg-primary-50 text-primary-700'
                          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                      }
                    `}
                  >
                    <span>{item.icon}</span>
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </nav>

        {/* User section */}
        <div className="border-t border-gray-100 p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary-700 to-primary-500 flex items-center justify-center text-white font-semibold">
              A
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">Admin User</p>
              <p className="text-xs text-gray-500 truncate">admin@praktiqu.id</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
