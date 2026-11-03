// Gathering everything an appointment needs to become a calendar event.
//
// Kept apart from the sync service so that service can be tested against a plain
// function instead of a database, and so the joins live in one place rather than
// being rediscovered each time someone needs a client's name.

import { prisma } from '@/lib/prisma';
import { findAppointmentsByIds } from '@/repositories/wp/appointments.repo';
import type { AppointmentForCalendar } from '@/services/integrations/google-event-payload';

/** What the sweep asks for: ids in, the details it can find out. */
export type AppointmentLoader = (
  ids: number[],
) => Promise<Map<number, AppointmentForCalendar>>;

/**
 * `visit_type` holds service ids, comma separated, not a human-readable type.
 *
 * Historic rows hold anything from `"12"` to `"12,13"` to an empty string. Parsed
 * leniently because a title is worth degrading, not failing over.
 */
function serviceIdsOf(visitType: string | null): bigint[] {
  if (!visitType) return [];
  return visitType
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part))
    .map((part) => BigInt(part));
}

export const loadAppointmentsForCalendar: AppointmentLoader = async (ids) => {
  const out = new Map<number, AppointmentForCalendar>();
  if (ids.length === 0) return out;

  const appointments = await findAppointmentsByIds(ids.map((id) => BigInt(id)));
  if (appointments.length === 0) return out;

  const serviceIds = [...new Set(appointments.flatMap((a) => serviceIdsOf(a.visitType)))];
  const clinicIds = [...new Set(appointments.map((a) => a.clinicId))];
  const userIds = [
    ...new Set([
      ...appointments.map((a) => a.patientId),
      ...appointments.map((a) => a.doctorId),
    ]),
  ];

  const [services, clinics, users] = await Promise.all([
    serviceIds.length
      ? prisma.kcService.findMany({
          where: { id: { in: serviceIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    prisma.kcClinic.findMany({
      where: { id: { in: clinicIds } },
      select: { id: true, name: true },
    }),
    prisma.kcUser.findMany({
      where: { id: { in: userIds } },
      select: { id: true, displayName: true, userEmail: true },
    }),
  ]);

  const serviceName = new Map(services.map((s) => [s.id.toString(), s.name]));
  const clinicName = new Map(clinics.map((c) => [c.id.toString(), c.name ?? null]));
  const user = new Map(users.map((u) => [u.id.toString(), u]));

  for (const appt of appointments) {
    // Without a date or times there is no event to place. Skipping leaves the row
    // unsynced and visible in the sweep's report rather than writing a nonsense
    // event at an invented hour.
    if (!appt.startDate || !appt.startTime || !appt.endTime) continue;

    const names = serviceIdsOf(appt.visitType)
      .map((id) => serviceName.get(id.toString()))
      .filter((n): n is string => Boolean(n));

    const patient = user.get(appt.patientId.toString());
    const doctor = user.get(appt.doctorId.toString());

    out.set(Number(appt.id), {
      appointmentId: Number(appt.id),
      date: appt.startDate,
      startTime: appt.startTime,
      // endDate is ignored on purpose: an appointment that crosses midnight is not
      // something this system produces, and honouring it here would silently
      // create a multi-day event out of a bad row.
      endTime: appt.endTime,
      serviceName: names.length > 0 ? names.join(', ') : 'Konsultasi',
      clientName: patient?.displayName?.trim() || 'Klien',
      clinicName: clinicName.get(appt.clinicId.toString()) ?? null,
      clientEmail: patient?.userEmail ?? null,
      professionalEmail: doctor?.userEmail ?? null,
    });
  }

  return out;
};
