'use client';

/**
 * Assigned services list — read-only display for self-service profile.
 * US5: read-only view of assigned services
 *
 * T055: read-only service list in self-service profile
 */

interface Service {
  id: string;
  serviceName: string;
  serviceDuration: number;
}

interface AssignedServicesListProps {
  services: Service[];
}

export function AssignedServicesList({ services }: AssignedServicesListProps) {
  if (services.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic">No services assigned yet. Contact your administrator.</p>
    );
  }

  return (
    <ul className="space-y-2">
      {services.map((s) => (
        <li key={s.id} className="flex items-center gap-2 text-sm">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-gray-800">{s.serviceName}</span>
          <span className="text-xs text-gray-400">({s.serviceDuration} min)</span>
        </li>
      ))}
    </ul>
  );
}