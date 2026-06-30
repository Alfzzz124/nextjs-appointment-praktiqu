/**
 * Admin clients list page.
 * US2: admin client management
 */
'use client';

import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface Client {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING';
  registeredAt: string;
  sessionsCount: number;
}

interface ListResponse {
  data: Client[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  PENDING: 'Pending',
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-gray-100 text-gray-600',
  PENDING: 'bg-yellow-100 text-yellow-700',
};

export default function AdminClientsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusFilter = searchParams.get('status') ?? '';
  const searchQuery = searchParams.get('search') ?? '';
  const page = parseInt(searchParams.get('page') ?? '1', 10);

  async function fetchClients(params: URLSearchParams) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/clients?${params.toString()}`);
      if (res.ok) {
        const json: ListResponse = await res.json();
        setData(json);
        router.push(`?${params.toString()}`, { scroll: false });
      } else {
        setError('Failed to load clients');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  function updateFilter(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.set('page', '1');
    fetchClients(params);
  }

  function goToPage(newPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(newPage));
    fetchClients(params);
  }

  const clients = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500 mt-1">Manage client records and information</p>
        </div>
        <button className="px-4 py-2 bg-primary-700 text-white rounded-lg text-sm font-medium hover:bg-primary-800 transition-colors">
          + Add Client
        </button>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-wrap gap-3 items-center bg-white p-4 rounded-xl border border-gray-200">
        <input
          type="search"
          placeholder="Search by name, email, or phone..."
          defaultValue={searchQuery}
          className="flex-1 min-w-[240px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              updateFilter('search', (e.target as HTMLInputElement).value || null);
            }
          }}
        />

        {/* Status filter chips */}
        <div className="flex gap-2">
          {['', 'ACTIVE', 'INACTIVE', 'PENDING'].map((status) => (
            <button
              key={status || 'ALL'}
              onClick={() => updateFilter('status', status || null)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                statusFilter === status
                  ? 'bg-primary-700 text-white border-transparent'
                  : 'text-gray-600 border-gray-300 hover:border-gray-400'
              }`}
            >
              {status ? STATUS_LABELS[status] : 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {error && (
          <div className="p-4 bg-red-50 border-b border-red-200 text-red-700 text-sm">
            {error} — <button onClick={() => fetchClients(new URLSearchParams())} className="underline">Retry</button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Phone</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Sessions</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Registered</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading...</td>
                </tr>
              )}
              {!loading && !error && clients.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No clients found
                  </td>
                </tr>
              )}
              {!loading && !error && clients.length === 0 && !data && (
                // Initial load - show empty state with retry
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    <div className="space-y-2">
                      <p>No clients yet</p>
                      <button
                        onClick={() => fetchClients(new URLSearchParams())}
                        className="text-primary-700 text-sm hover:underline"
                      >
                        Load from API
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {clients.map((client) => (
                <tr key={client.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{client.fullName}</td>
                  <td className="px-4 py-3 text-gray-600">{client.email}</td>
                  <td className="px-4 py-3 text-gray-600">{client.phone ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[client.status]}`}>
                      {STATUS_LABELS[client.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{client.sessionsCount}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {new Date(client.registeredAt).toLocaleDateString('id-ID')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/client/profile/${client.id}`}
                      className="text-primary-700 hover:text-primary-800 text-sm font-medium"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 text-sm">
            <span className="text-gray-500">
              Showing {(page - 1) * pagination.pageSize + 1}–{Math.min(page * pagination.pageSize, pagination.totalItems)} of {pagination.totalItems}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1}
                className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => goToPage(page + 1)}
                disabled={page >= pagination.totalPages}
                className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
