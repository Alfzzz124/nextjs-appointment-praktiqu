// src/app/api/v1/public/booking/route.ts
// Public booking submission - writes to WordPress wp_kc_appointments
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { slotHoldService } from '@/services/booking/slot-hold.service';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const publicBookingSchema = z.object({
  professionalId: z.string().min(1),
  serviceId: z.string().min(1),
  date: z.string().min(1),
  startTime: z.string().min(1),
  clientName: z.string().min(1).max(255),
  clientEmail: z.string().email(),
  clientMobile: z.string().min(1).max(32),
  notes: z.string().max(1000).optional(),
  holdKey: z.string().min(1),
});

function escapeString(str: string): string {
  return str.replace(/'/g, "''");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = publicBookingSchema.parse(body);

    // Verify slot hold is still active
    const hold = slotHoldService.get(parsed.holdKey);
    if (!hold) {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Slot hold expired',
          status: 410,
          detail: 'Slot no longer available — please select another time',
        },
        { status: 410 },
      );
    }

    const professionalId = parseInt(parsed.professionalId);
    const serviceId = parseInt(parsed.serviceId);

    // Get service details to calculate end time
    const serviceResult = await prisma.$queryRawUnsafe<any[]>(`
      SELECT s.name, COALESCE(sdm.duration, 60) as duration, sdm.charges, sdm.clinic_id
      FROM wp_kc_services s
      LEFT JOIN wp_kc_service_doctor_mapping sdm ON s.id = sdm.service_id AND sdm.doctor_id = ${professionalId}
      WHERE s.id = ${serviceId}
      LIMIT 1
    `);

    if (!serviceResult || serviceResult.length === 0) {
      return NextResponse.json(
        { type: 'about:blank', title: 'Service not found', status: 404 },
        { status: 404 },
      );
    }

    const service = serviceResult[0];
    const serviceName = service.name;
    const duration = Number(service.duration) || 60;
    const clinicId = Number(service.clinic_id) || 1;

    // Calculate end time
    const [hh, mm] = parsed.startTime.split(':').map(Number);
    const endMinutes = hh * 60 + mm + duration;
    const endTime = `${Math.floor(endMinutes / 60).toString().padStart(2, '0')}:${(endMinutes % 60).toString().padStart(2, '0')}:00`;

    // Check for double-booking in WordPress
    const conflictCheck = await prisma.$queryRawUnsafe<any[]>(`
      SELECT id FROM wp_kc_appointments
      WHERE doctor_id = ${professionalId}
        AND status IN (1, 2, 4, 5)
        AND appointment_start_date = '${parsed.date}'
        AND (
          (appointment_start_time <= '${parsed.startTime}' AND appointment_end_time > '${parsed.startTime}')
          OR
          (appointment_start_time < '${endTime}' AND appointment_end_time >= '${endTime}')
          OR
          (appointment_start_time >= '${parsed.startTime}' AND appointment_end_time <= '${endTime}')
        )
      LIMIT 1
    `);

    if (conflictCheck.length > 0) {
      slotHoldService.consume(parsed.holdKey);
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Slot no longer available',
          status: 409,
        },
        { status: 409 },
      );
    }

    // Get or create patient in WordPress
    let patientId: number;
    const safeEmail = escapeString(parsed.clientEmail);
    const existingPatient = await prisma.$queryRawUnsafe<any[]>(`
      SELECT u.ID FROM wp_users u WHERE u.user_email = '${safeEmail}' LIMIT 1
    `);

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const safeName = escapeString(parsed.clientName);
    const safeMobile = escapeString(parsed.clientMobile);
    const safeNotes = escapeString(parsed.notes || '');

    if (existingPatient.length > 0) {
      patientId = Number(existingPatient[0].ID);
    } else {
      // Create new WordPress user for patient
      const username = parsed.clientEmail.split('@')[0].substring(0, 60);
      const safeUsername = escapeString(username);
      // Generate a random placeholder password hash
      const passwordHash = '$p$' + Math.random().toString(36).substring(2).substring(0, 22);

      try {
        await prisma.$queryRawUnsafe(`
          INSERT INTO wp_users (user_login, user_pass, user_nicename, display_name, user_email, user_registered, user_status)
          VALUES ('${safeUsername}', '${passwordHash}', '${safeUsername}', '${safeName}', '${safeEmail}', '${now}', 0)
        `);
      } catch (createErr: any) {
        console.error('Error creating user:', createErr.message);
      }

      const newUser = await prisma.$queryRawUnsafe<any[]>(`SELECT LAST_INSERT_ID() as id`);
      patientId = Number(newUser[0]?.id) || 1;

      // Create patient in clinic mapping
      try {
        await prisma.$queryRawUnsafe(`
          INSERT INTO wp_kc_patient_clinic_mappings (patient_id, clinic_id, created_at)
          VALUES (${patientId}, ${clinicId}, '${now}')
        `);
      } catch (mapErr: any) {
        console.error('Error creating patient mapping:', mapErr.message);
      }

      // Update patient meta
      try {
        const firstName = parsed.clientName.split(' ')[0];
        const lastName = parsed.clientName.split(' ').slice(1).join(' ') || '-';
        await prisma.$queryRawUnsafe(`
          INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES
          (${patientId}, 'first_name', '${escapeString(firstName)}'),
          (${patientId}, 'last_name', '${escapeString(lastName)}'),
          (${patientId}, 'wp_capabilities', 'a:1:{s:15:\"kiviCare_patient\";b:1;}'),
          (${patientId}, 'wp_user_level', '0')
        `);
      } catch (metaErr: any) {
        console.error('Error creating user meta:', metaErr.message);
      }
    }

    // Create appointment in WordPress
    const appointmentDate = parsed.date;
    const startTimeStr = parsed.startTime + ':00';
    const endDateStr = parsed.date;

    try {
      await prisma.$queryRawUnsafe(`
        INSERT INTO wp_kc_appointments (
          appointment_start_date, appointment_start_time, appointment_end_date, appointment_end_time,
          visit_type, clinic_id, doctor_id, patient_id, description, status,
          created_at, appointment_start_utc, appointment_end_utc, appointment_timezone, created_at_utc
        ) VALUES (
          '${appointmentDate}', '${startTimeStr}', '${endDateStr}', '${endTime}',
          'in_person', ${clinicId}, ${professionalId}, ${patientId}, '${safeNotes}', 2,
          '${now}', '${appointmentDate} ${startTimeStr}', '${endDateStr} ${endTime}', 'Asia/Jakarta', '${now}'
        )
      `);
    } catch (apptErr: any) {
      console.error('Error creating appointment:', apptErr.message);
      return NextResponse.json(
        { type: 'about:blank', title: 'Failed to create appointment', status: 500, detail: apptErr.message },
        { status: 500 },
      );
    }

    // Get the inserted appointment ID
    const appointmentResult = await prisma.$queryRawUnsafe<any[]>(`SELECT LAST_INSERT_ID() as id`);
    const appointmentId = Number(appointmentResult[0]?.id) || 0;

    // Create service mapping for the appointment
    try {
      await prisma.$queryRawUnsafe(`
        INSERT INTO wp_kc_appointment_service_mapping (appointment_id, service_id, price, created_at)
        VALUES (${appointmentId}, ${serviceId}, '${service.charges || '0'}', '${now}')
      `);
    } catch (svcErr: any) {
      console.error('Error creating service mapping:', svcErr.message);
    }

    // Get professional name
    const professionalResult = await prisma.$queryRawUnsafe<any[]>(`
      SELECT display_name FROM wp_users WHERE ID = ${professionalId} LIMIT 1
    `);
    const professionalName = professionalResult[0]?.display_name || 'Professional';

    // Consume the hold
    slotHoldService.consume(parsed.holdKey);

    return NextResponse.json(
      {
        id: String(appointmentId),
        status: 'PENDING',
        date: parsed.date,
        startTime: parsed.startTime,
        service: serviceName,
        professionalName: professionalName,
        clientName: parsed.clientName,
      },
      { status: 201 },
    );
  } catch (err: any) {
    console.error('Booking error:', err);
    if (err?.name === 'ZodError') {
      return NextResponse.json(
        { type: 'about:blank', title: 'Validation failed', status: 400, errors: err.errors },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500, detail: err.message },
      { status: 500 },
    );
  }
}