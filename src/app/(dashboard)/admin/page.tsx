/**
 * Admin dashboard page with stats and quick actions.
 * Shows overview of today's sessions, upcoming appointments, clients, and revenue.
 */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Stats {
  todaySessions: number;
  upcomingSessions: number;
  totalClients: number;
  monthlyRevenue: number;
}

interface UpcomingSession {
  id: string;
  time: string;
  clientName: string;
  professionalName: string;
  service: string;
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
}

interface Activity {
  id: string;
  description: string;
  timestamp: string;
  type: 'session_booked' | 'client_registered' | 'payment_received';
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-500',
  CONFIRMED: 'bg-blue-500',
  COMPLETED: 'bg-green-500',
  CANCELLED: 'bg-red-500',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats>({
    todaySessions: 0,
    upcomingSessions: 0,
    totalClients: 0,
    monthlyRevenue: 0,
  });
  const [upcomingSessions, setUpcomingSessions] = useState<UpcomingSession[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulated data - replace with actual API calls
    setTimeout(() => {
      setStats({
        todaySessions: 5,
        upcomingSessions: 8,
        totalClients: 142,
        monthlyRevenue: 12500000,
      });
      setUpcomingSessions([
        { id: '1', time: '09:00', clientName: 'Sarah Putri', professionalName: 'Dr. Ratna', service: 'Konseling Individual', status: 'PENDING' },
        { id: '2', time: '10:00', clientName: 'Budi Santoso', professionalName: 'Dr. Budi', service: 'Konseling Pasangan', status: 'CONFIRMED' },
        { id: '3', time: '11:00', clientName: 'Ani Wijaya', professionalName: 'Dr. Ratna', service: 'Konseling Individual', status: 'CONFIRMED' },
        { id: '4', time: '14:00', clientName: 'Dewi Kusuma', professionalName: 'Sari, M.Psi', service: 'Psikologi Anak', status: 'PENDING' },
        { id: '5', time: '15:00', clientName: 'Rudi Hermawan', professionalName: 'Dr. Budi', service: 'Asesmen Psikologis', status: 'CONFIRMED' },
      ]);
      setActivities([
        { id: '1', description: 'New session booked - Sarah Putri', timestamp: '2 minutes ago', type: 'session_booked' },
        { id: '2', description: 'Client registered - Ahmad Fauzi', timestamp: '15 minutes ago', type: 'client_registered' },
        { id: '3', description: 'Payment received - Rp 500,000', timestamp: '1 hour ago', type: 'payment_received' },
        { id: '4', description: 'Session completed - Budi Santoso', timestamp: '2 hours ago', type: 'session_booked' },
      ]);
      setLoading(false);
    }, 500);
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon="📅"
          label="Today Sessions"
          value={stats.todaySessions}
          loading={loading}
          color="blue"
        />
        <StatCard
          icon="⏰"
          label="Upcoming"
          value={stats.upcomingSessions}
          loading={loading}
          color="yellow"
        />
        <StatCard
          icon="👥"
          label="Total Clients"
          value={stats.totalClients}
          loading={loading}
          color="green"
        />
        <StatCard
          icon="💰"
          label="Monthly Revenue"
          value={formatCurrency(stats.monthlyRevenue)}
          loading={loading}
          color="purple"
          isText
        />
      </div>

      {/* Quick actions */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Quick Actions</h2>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/sessions"
            className="px-4 py-2 bg-primary-700 text-white rounded-lg text-sm font-medium hover:bg-primary-800 transition-colors"
          >
            + New Session
          </Link>
          <Link
            href="/admin/clients"
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Add Client
          </Link>
          <Link
            href="/admin/sessions"
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            📅 Calendar
          </Link>
        </div>
      </div>

      {/* Two column layout */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Upcoming sessions */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Upcoming Sessions</h2>
            <Link href="/admin/sessions" className="text-xs text-primary-700 hover:underline">
              View All →
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {loading ? (
              <div className="p-4 text-center text-gray-500">Loading...</div>
            ) : upcomingSessions.length === 0 ? (
              <div className="p-4 text-center text-gray-500">No upcoming sessions</div>
            ) : (
              upcomingSessions.map((session) => (
                <div key={session.id} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50">
                  <div className="text-center">
                    <div className="text-lg font-bold text-gray-900">{session.time}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 truncate">{session.clientName}</div>
                    <div className="text-xs text-gray-500 truncate">{session.professionalName} • {session.service}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${STATUS_COLORS[session.status]}`} />
                    <span className="text-xs text-gray-600">{STATUS_LABELS[session.status]}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent activity */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Recent Activity</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {loading ? (
              <div className="p-4 text-center text-gray-500">Loading...</div>
            ) : activities.length === 0 ? (
              <div className="p-4 text-center text-gray-500">No recent activity</div>
            ) : (
              activities.map((activity) => (
                <div key={activity.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="text-lg">
                    {activity.type === 'session_booked' ? '📅' : activity.type === 'client_registered' ? '👤' : '💳'}
                  </span>
                  <div className="flex-1">
                    <div className="text-sm text-gray-700">{activity.description}</div>
                    <div className="text-xs text-gray-400">{activity.timestamp}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  icon: string;
  label: string;
  value: number | string;
  loading: boolean;
  color: 'blue' | 'yellow' | 'green' | 'purple';
  isText?: boolean;
}

function StatCard({ icon, label, value, loading, color, isText }: StatCardProps) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-700',
    yellow: 'bg-yellow-50 text-yellow-700',
    green: 'bg-green-50 text-green-700',
    purple: 'bg-purple-50 text-purple-700',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colorMap[color]}`}>
          <span className="text-xl">{icon}</span>
        </div>
        <div>
          {loading ? (
            <div className="h-6 w-12 bg-gray-200 animate-pulse rounded" />
          ) : (
            <div className={`font-bold text-gray-900 ${isText ? 'text-lg' : 'text-2xl'}`}>
              {value}
            </div>
          )}
          <div className="text-xs text-gray-500">{label}</div>
        </div>
      </div>
    </div>
  );
}
