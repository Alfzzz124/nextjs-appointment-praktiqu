// Did a public booking request already get written? Asked when its Idempotency-Key was
// left unfinished by a process that died: the answer decides between "answer with that
// appointment" and "write it now". Kept out of public-booking.service so that file keeps
// one job, and out of booking-idempotency.service so that one stays free of WordPress.

import { findActiveAppointmentIdAt } from '@/repositories/wp/appointments.repo';
import { findPatientByEmail } from '@/repositories/wp/patients.repo';

export async function findWrittenPublicAppointment(input: {
  professionalId: number;
  date: string;
  startTime: string;
  clientEmail: string;
}): Promise<number | null> {
  // No patient for that email means the dead attempt never got as far as creating one,
  // so it cannot have written the appointment either.
  const patient = await findPatientByEmail(input.clientEmail);
  if (!patient) return null;

  return findActiveAppointmentIdAt({
    doctorId: BigInt(input.professionalId),
    patientId: patient.id,
    date: input.date,
    // The service stores HH:MM:SS; the request carries HH:MM.
    startTime: input.startTime.length === 5 ? `${input.startTime}:00` : input.startTime,
  });
}
