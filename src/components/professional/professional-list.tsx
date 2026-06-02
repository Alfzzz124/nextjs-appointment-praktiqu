'use client';

/**
 * Professional list component with pagination, search, and status filter chips.
 * US1: admin list for professionals
 */

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ProfessionalStatus } from '@prisma/client';
import { StatusBadge } from './status-badge';

interface Professional {
  id: string;
  fullName: string;
  email: string;
  professionalType: string;
  registrationNumber: string;
  status: ProfessionalStatus;
  practice: { id: string; name: string } | null;
  createdAt: string;
}

interface ListResponse {
  data: Professional[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

const PROFESSIONAL_TYPE_LABELS: Record<string, string> = {
  PSIKOLOG_KLINIS: 'Psikolog Klinis',
  PSIKOLOG_ANAK: 'Psikolog Anak',
  PSIKIATER: 'Psikiater',
  KONSELOR: 'Konselor',
};

const STATUS_LABELS: Record<ProfessionalStatus, string> = {
  PENDING_ACTIVATION: 'Pending',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

const STATUS_COLORS: Record<ProfessionalStatus, string> = {
  PENDING_ACTIVATION: '#f59e0b',
  ACTIVE: '#10b981',
  INACTIVE: '#6b7280',
};

interface ProfessionalListProps {
  initialData?: ListResponse;
}

export function ProfessionalList({ initialData }: ProfessionalListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ListResponse | null>(initialData ?? null);
  const [loading, setLoading] = useState(false);

  const statusFilter = searchParams.get('status') as ProfessionalStatus | null;
  const searchQuery = searchParams.get('search') ?? '';
  const page = parseInt(searchParams.get('page') ?? '1', 10);

  async function fetchProfessionals(params: URLSearchParams) {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/professionals?${params.toString()}`);
      if (res.ok) {
        const json: ListResponse = await res.json();
        setData(json);
        router.push(`?${params.toString()}`, { scroll: false });
      }
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
    fetchProfessionals(params);
  }

  function goToPage(newPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(newPage));
    fetchProfessionals(params);
  }

  const professionals = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-4">
      {/* Search + Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="search"
          placeholder="Search by name, email, or registration number..."
          defaultValue={searchQuery}
          className="flex-1 min-w-[240px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              updateFilter('search', (e.target as HTMLInputElement).value || null);
            }
          }}
        />

        {/* Status filter chips */}
        <div className="flex gap-2">
          {(['ACTIVE', 'INACTIVE', 'PENDING_ACTIVATION'] as ProfessionalStatus[]).map((status) => (
            <button
              key={status}
              onClick={() => updateFilter('status', statusFilter === status ? null : status)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                statusFilter === status
                  ? 'text-white border-transparent'
                  : 'text-gray-600 border-gray-300 hover:border-gray-400'
              }`}
              style={statusFilter === status ? { backgroundColor: STATUS_COLORS[status] } : undefined}
            >
              {STATUS_LABELS[status]}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Registration</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Practice</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading...</td>
              </tr>
            )}
            {!loading && professionals.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">No professionals found</td>
              </tr>
            )}
            {professionals.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{p.fullName}</td>
                <td className="px-4 py-3 text-gray-600">{p.email}</td>
                <td className="px-4 py-3 text-gray-600">{PROFESSIONAL_TYPE_LABELS[p.professionalType] ?? p.professionalType}</td>
                <td className="px-4 py-3 text-gray-600 font-mono text-xs">{p.registrationNumber}</td>
                <td className="px-4 py-3 text-gray-600">{p.practice?.name ?? '—'}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={p.status} />
                </td>
                <td className="px-4 py-3 text-right">
                  <a href={`/admin/professionals/${p.id}`} className="text-blue-600 hover:text-blue-800 text-sm">
                    View
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
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
  );
}