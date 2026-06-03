// src/app/(public)/book/[professionalId]/[serviceId]/page.tsx
// Step 3: Date and time slot selection
import { WizardLayout } from '@/components/booking/wizard-layout';
import { prisma } from '@/lib/prisma';
import { SlotPicker } from '@/components/booking/slot-picker';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface SlotData {
  startTime: string;
  endTime: string;
  startUtc: string;
}

interface DayData {
  date: string;
  slots: SlotData[];
}

interface ServiceInfo {
  id: string;
  name: string;
  duration: number;
}

interface ProfessionalInfo {
  id: string;
  fullName: string;
}

// Day name to number mapping
const DAY_MAP: Record<string, number> = {
  'sun': 0, 'sunday': 0,
  'mon': 1, 'monday': 1,
  'tue': 2, 'tuesday': 2,
  'wed': 3, 'wednesday': 3,
  'thu': 4, 'thursday': 4,
  'fri': 5, 'friday': 5,
  'sat': 6, 'saturday': 6,
};

function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(':').map(Number);
  return { hours: h || 0, minutes: m || 0 };
}

function timeToMinutes(timeStr: string): number {
  const { hours, minutes } = parseTime(timeStr);
  return hours * 60 + minutes;
}

function formatTime(hours: number, minutes: number): string {
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

async function getData(professionalId: string, serviceId: string) {
  try {
    // Get professional info
    const userResult = await prisma.$queryRawUnsafe<any[]>(`
      SELECT ID, display_name FROM wp_users WHERE ID = ${parseInt(professionalId)} LIMIT 1
    `);

    if (!userResult || userResult.length === 0) {
      return { professional: null, service: null, availability: [], existingAppts: [] };
    }

    const professional: ProfessionalInfo = {
      id: String(userResult[0].ID),
      fullName: userResult[0].display_name || 'Professional',
    };

    // Get service info
    const serviceResult = await prisma.$queryRawUnsafe<any[]>(`
      SELECT s.id, s.name, COALESCE(sdm.duration, 60) as duration
      FROM wp_kc_services s
      LEFT JOIN wp_kc_service_doctor_mapping sdm ON s.id = sdm.service_id AND sdm.doctor_id = ${parseInt(professionalId)}
      WHERE s.id = ${parseInt(serviceId)}
      LIMIT 1
    `);

    if (!serviceResult || serviceResult.length === 0) {
      return { professional, service: null, availability: [], existingAppts: [] };
    }

    const service: ServiceInfo = {
      id: String(serviceResult[0].id),
      name: serviceResult[0].name || 'Service',
      duration: serviceResult[0].duration || 60,
    };

    // Get availability from clinic_sessions
    const sessionsRaw = await prisma.$queryRawUnsafe<any[]>(`
      SELECT day, start_time, end_time, time_slot
      FROM wp_kc_clinic_sessions
      WHERE doctor_id = ${parseInt(professionalId)}
        AND start_time IS NOT NULL
        AND end_time IS NOT NULL
    `);

    // Parse availability - MySQL TIME returns as string like "19:30:00" or Date object
    const availability = sessionsRaw.map((s) => {
      const dayNum = DAY_MAP[s.day?.toLowerCase()] ?? -1;

      // Parse start_time - handle both string and Date
      let startMin = 0;
      if (typeof s.start_time === 'string') {
        startMin = timeToMinutes(s.start_time);
      } else if (s.start_time instanceof Date) {
        startMin = s.start_time.getUTCHours() * 60 + s.start_time.getUTCMinutes();
      }

      // Parse end_time
      let endMin = 0;
      if (typeof s.end_time === 'string') {
        endMin = timeToMinutes(s.end_time);
      } else if (s.end_time instanceof Date) {
        endMin = s.end_time.getUTCHours() * 60 + s.end_time.getUTCMinutes();
      }

      const slotDuration = s.time_slot || 60;

      return {
        dayOfWeek: dayNum,
        startMinute: startMin,
        endMinute: endMin,
        slotDuration,
      };
    });

    // Get existing appointments
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const twoWeeksLater = new Date(today);
    twoWeeksLater.setDate(today.getDate() + 14);

    const existingAppts = await prisma.$queryRawUnsafe<any[]>(`
      SELECT appointment_start_date, appointment_start_time, appointment_end_time
      FROM wp_kc_appointments
      WHERE doctor_id = ${parseInt(professionalId)}
        AND status IN (1, 2, 4, 5)
        AND appointment_start_date >= CURDATE()
        AND appointment_start_date < DATE_ADD(CURDATE(), INTERVAL 14 DAY)
    `);

    return { professional, service, availability, existingAppts };
  } catch (err) {
    console.error('Error in getData:', err);
    return { professional: null, service: null, availability: [], existingAppts: [] };
  }
}

function generateSlots(availability: any[], existingBookings: any[], date: Date, duration: number): SlotData[] {
  const dayOfWeek = date.getDay();
  const dateStr = date.toISOString().slice(0, 10);

  // Find matching availability for this day
  const dayAvail = availability.filter((a) => a.dayOfWeek === dayOfWeek);
  if (dayAvail.length === 0) return [];

  const slots: SlotData[] = [];

  for (const avail of dayAvail) {
    const slotDuration = avail.slotDuration || duration;

    // Generate slots
    let currentMin = avail.startMinute;
    const endMin = avail.endMinute;

    while (currentMin + slotDuration <= endMin) {
      const startTime = formatTime(Math.floor(currentMin / 60), currentMin % 60);
      const endMinutes = currentMin + slotDuration;
      const endTime = formatTime(Math.floor(endMinutes / 60), endMinutes % 60);

      // Check if slot conflicts with existing bookings
      const slotStart = `${dateStr} ${startTime}`;
      const slotEnd = `${dateStr} ${endTime}`;

      const isBooked = existingBookings.some((booking: any) => {
        const bookDate = booking.appointment_start_date;
        const bookStart = `${bookDate} ${booking.appointment_start_time}`;
        const bookEnd = booking.appointment_end_time
          ? `${bookDate} ${booking.appointment_end_time}`
          : bookStart;

        // Check overlap
        return (slotStart >= bookStart && slotStart < bookEnd) ||
               (slotEnd > bookStart && slotEnd <= bookEnd);
      });

      if (!isBooked) {
        slots.push({
          startTime,
          endTime,
          startUtc: `${dateStr}T${startTime}:00`,
        });
      }

      currentMin += slotDuration;
    }
  }

  return slots.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export default async function BookStep3Page({
  params,
}: {
  params: { professionalId: string; serviceId: string };
}) {
  const { professional, service, availability, existingAppts } = await getData(
    params.professionalId,
    params.serviceId,
  );

  if (!professional || !service) {
    return (
      <WizardLayout currentStep={3}>
        <div className="card text-center text-sm text-[#777587]">Layanan tidak ditemukan.</div>
      </WizardLayout>
    );
  }

  const duration = service.duration;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });

  const daySlots = days.map((date) => {
    const slots = generateSlots(availability, existingAppts, date, duration);
    return { date, slots };
  });

  return (
    <WizardLayout currentStep={3}>
      <div className="mb-6">
        <Link
          href={`/book/${params.professionalId}/service`}
          className="text-sm text-[#464555] hover:text-[#3625cd]"
        >
          ← Kembali pilih layanan
        </Link>
      </div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1b1b24]">Pilih Jadwal</h1>
        <p className="mt-1 text-sm text-[#464555]">
          {service.name} dengan <strong>{professional.fullName}</strong> ({duration} menit)
        </p>
      </div>
      <SlotPicker
        professionalId={params.professionalId}
        serviceId={params.serviceId}
        days={daySlots.map((d) => ({
          date: d.date.toISOString().slice(0, 10),
          slots: d.slots,
        }))}
      />
    </WizardLayout>
  );
}