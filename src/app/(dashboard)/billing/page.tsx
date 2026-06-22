/**
 * Billing overview page.
 * US6: billing management
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';

interface Invoice {
  id: string;
  invoiceNumber: string;
  clientName: string;
  amount: number;
  status: 'PAID' | 'PENDING' | 'OVERDUE' | 'CANCELLED';
  issuedAt: string;
  dueAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  PAID: 'bg-green-100 text-green-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  OVERDUE: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-600',
};

const STATUS_LABELS: Record<string, string> = {
  PAID: 'Paid',
  PENDING: 'Pending',
  OVERDUE: 'Overdue',
  CANCELLED: 'Cancelled',
};

export default function BillingPage() {
  const [invoices] = useState<Invoice[]>([]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
          <p className="text-sm text-gray-500 mt-1">Manage invoices and payments</p>
        </div>
        <Link
          href="/billing/new"
          className="px-4 py-2 bg-primary-700 text-white rounded-lg text-sm font-medium hover:bg-primary-800 transition-colors"
        >
          + Create Invoice
        </Link>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-gray-900">0</div>
          <div className="text-xs text-gray-500">Total Invoices</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-yellow-600">0</div>
          <div className="text-xs text-gray-500">Pending</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-green-600">Rp 0</div>
          <div className="text-xs text-gray-500">Paid This Month</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-red-600">0</div>
          <div className="text-xs text-gray-500">Overdue</div>
        </div>
      </div>

      {/* Invoices table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Invoice #</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Client</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Amount</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Issued</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Due</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    <div className="space-y-2">
                      <p>No invoices yet</p>
                      <Link href="/billing/new" className="text-primary-700 text-sm hover:underline">
                        Create your first invoice →
                      </Link>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reports link */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <Link
          href="/billing/reports"
          className="flex items-center justify-between text-sm font-medium text-gray-700 hover:text-primary-700"
        >
          <span>📊 View Reports</span>
          <span>→</span>
        </Link>
      </div>
    </div>
  );
}
