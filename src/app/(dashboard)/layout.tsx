/**
 * Dashboard layout - wraps all /admin/*, /billing/*, /settings/* routes
 * with sidebar navigation and top bar.
 */
import { DashboardLayout } from '@/components/layout/dashboard-layout';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
