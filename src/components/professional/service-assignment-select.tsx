'use client';

/**
 * Service assignment select — searchable multi-select for admin.
 * US5: assign services to professional
 *
 * T054: searchable multi-select showing service name, duration, status
 */

import { useState } from 'react';

interface Service {
  id: string;
  name: string;
  duration: number;
  status: number;
}

interface ServiceAssignmentSelectProps {
  professionalId: string;
  assignedServices: Service[];
  allServices: Service[];
  onAssign: (serviceId: string) => Promise<void>;
  onUnassign: (serviceId: string) => Promise<void>;
}

export function ServiceAssignmentSelect({
  professionalId,
  assignedServices,
  allServices,
  onAssign,
  onUnassign,
}: ServiceAssignmentSelectProps) {
  const [search, setSearch] = useState('');
  const [assigning, setAssigning] = useState(false);

  const assignedIds = new Set(assignedServices.map((s) => s.id));

  const availableServices = allServices
    .filter((s) => s.status === 1 && !assignedIds.has(s.id))
    .filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 20);

  async function handleAssign(serviceId: string) {
    setAssigning(true);
    try {
      await onAssign(serviceId);
    } finally {
      setAssigning(false);
    }
  }

  async function handleUnassign(serviceId: string) {
    setAssigning(true);
    try {
      await onUnassign(serviceId);
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Currently assigned */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-2">Assigned Services</h4>
        {assignedServices.length === 0 && (
          <p className="text-xs text-gray-400">No services assigned yet</p>
        )}
        {assignedServices.map((s) => (
          <div key={s.id} className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-4 py-2 mb-1">
            <div>
              <span className="text-sm font-medium text-gray-800">{s.name}</span>
              <span className="text-xs text-gray-500 ml-2">{s.duration} min</span>
            </div>
            <button
              type="button"
              onClick={() => handleUnassign(s.id)}
              disabled={assigning}
              className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {/* Add new service */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-2">Add Service</h4>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search services..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2"
        />
        {availableServices.length === 0 && (
          <p className="text-xs text-gray-400">No available services found</p>
        )}
        {availableServices.map((s) => (
          <div key={s.id} className="flex items-center justify-between border-b border-gray-100 py-2">
            <div>
              <span className="text-sm text-gray-800">{s.name}</span>
              <span className="text-xs text-gray-500 ml-2">{s.duration} min</span>
            </div>
            <button
              type="button"
              onClick={() => handleAssign(s.id)}
              disabled={assigning}
              className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
            >
              + Assign
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}