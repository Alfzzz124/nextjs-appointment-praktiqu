<?php
/**
 * External effects of a schedule move, run by Schedule_Outbox_Processor once the move has
 * committed: the online-session event (Google Meet / Zoom), the professional's Google
 * Calendar event (KiviCare Pro), and KiviCare's own reminder actions.
 *
 * Each step does nothing for an appointment that has none of these. On 2026-10-21 that was
 * every upcoming appointment: bookings made through PraktiQU create no Meet or Calendar
 * event, and KiviCare Pro's reminder action was never being scheduled. PraktiQU's own
 * reminders are rescheduled by the Next.js app, not here.
 *
 * Both steps can run again safely: they set the event to the new time, and move a pending
 * reminder by the shift between the old and the new start.
 *
 * Mirrors what KiviCare does when its own admin moves an appointment
 * (AppointmentsController::updateAppointment), minus `kc_appointment_updated`: KiviCare
 * Pro's listeners on it read custom-form fields from the request and would blank them.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class Schedule_Sync
{
    /** KiviCare's reminder actions: Pro's (used while Pro is active) and core's. */
    private const REMINDERS = [
        ['kivicare_pro_appointment_reminder', 'kivicare-pro-reminders'],
        ['kivicare_appointment_reminder', 'kivicare-reminders'],
    ];

    /**
     * Move the appointment's Meet/Zoom event and Google Calendar event to the new time.
     * Throws when a telemed provider refuses the update. KiviCare Pro's calendar sync
     * catches and logs its own errors, so that step is best effort.
     *
     * @param array{to:array{date:string,start:string,end:string},timezone:string} $payload
     */
    public function calendar(int $appointmentId, array $payload): void
    {
        $appointment = \App\models\KCAppointment::find($appointmentId);
        if (!$appointment) {
            return;
        }
        $zone = new \DateTimeZone((string) ($payload['timezone'] ?? 'UTC'));
        $start = new \DateTimeImmutable($payload['to']['date'] . ' ' . $payload['to']['start'], $zone);
        $end = new \DateTimeImmutable($payload['to']['date'] . ' ' . $payload['to']['end'], $zone);
        $services = $this->services($appointmentId);

        $provider = $this->provider((int) $appointment->doctorId);
        $meeting = $provider ? $provider->get_meeting_by_appointment($appointmentId) : null;
        if ($provider && $meeting) {
            if ($provider->get_provider_id() === 'googlemeet' && !empty($meeting->eventId)) {
                $names = $services->pluck('name')->toArray();
                $updated = $provider->update_meeting($meeting->eventId, [
                    'appointment_id' => $appointmentId,
                    'topic' => $names !== [] ? implode(', ', $names) : 'Telemed Appointment',
                    'summary' => $appointment->description,
                    'attendees' => array_values(array_filter([
                        get_userdata((int) $appointment->patientId)->user_email ?? '',
                        get_userdata((int) $appointment->doctorId)->user_email ?? '',
                    ])),
                    'doctor_id' => (int) $appointment->doctorId,
                    'start_time' => $start->format('Y-m-d\TH:i:sP'),
                    'end_time' => $end->format('Y-m-d\TH:i:sP'),
                    'timezone' => $zone->getName(),
                ]);
                if ($updated === false) {
                    throw new \RuntimeException('meet_update_failed');
                }
            } elseif ($provider->get_provider_id() === 'zoom' && !empty($meeting->zoomId)) {
                $updated = $provider->update_meeting($meeting->zoomId, [
                    'start_time' => $start->format('Y-m-d H:i:s'),
                    'duration' => intdiv($end->getTimestamp() - $start->getTimestamp(), 60),
                    'doctor_id' => (int) $appointment->doctorId,
                ]);
                if ($updated === false) {
                    throw new \RuntimeException('zoom_update_failed');
                }
            }
        }

        if (class_exists('\KCProApp\controllers\api\GoogleCalendarIntegration') && $this->has_calendar_event($appointmentId)) {
            // Updates the events it finds through their stored ids, as KiviCare's own
            // syncAppointmentToGoogleCalendars does after a move.
            $data = $appointment->toArray();
            $data['status'] = $appointment->status;
            \KCProApp\controllers\api\GoogleCalendarIntegration::getInstance()->addAppointmentToGoogleCalendars(
                $appointmentId,
                $data,
                \App\models\KCClinic::find($appointment->clinicId),
                \App\models\KCPatient::find($appointment->patientId),
                \App\models\KCDoctor::find($appointment->doctorId),
                $services
            );
        }
    }

    /**
     * Move a pending KiviCare reminder by the shift between the old and the new start, so it
     * keeps its distance from the session. One that would now fall in the past is dropped.
     *
     * @param array{from:array{date:string,start:string},to:array{date:string,start:string},timezone:string} $payload
     */
    public function reminders(int $appointmentId, array $payload): void
    {
        $zone = new \DateTimeZone((string) ($payload['timezone'] ?? 'UTC'));
        $shift = (new \DateTimeImmutable($payload['to']['date'] . ' ' . $payload['to']['start'], $zone))->getTimestamp()
            - (new \DateTimeImmutable($payload['from']['date'] . ' ' . $payload['from']['start'], $zone))->getTimestamp();

        foreach (self::REMINDERS as [$hook, $group]) {
            $next = as_next_scheduled_action($hook, [$appointmentId], $group);
            if (!is_int($next)) {
                continue;
            }
            as_unschedule_action($hook, [$appointmentId], $group);
            if ($next + $shift > time()) {
                as_schedule_single_action($next + $shift, $hook, [$appointmentId], $group);
            }
        }
    }

    /** The online session link after a move (a Meet update can issue a new one), or null. */
    public function meeting_url(int $appointmentId): ?string
    {
        $appointment = \App\models\KCAppointment::find($appointmentId);
        $provider = $appointment ? $this->provider((int) $appointment->doctorId) : null;
        $meeting = $provider ? $provider->get_meeting_by_appointment($appointmentId) : null;
        $url = $meeting ? ($meeting->url ?? $meeting->joinUrl ?? null) : null;

        return is_string($url) && $url !== '' ? $url : null;
    }

    private function provider(int $doctorId): ?object
    {
        return class_exists('\App\baseClasses\KCTelemedFactory')
            ? \App\baseClasses\KCTelemedFactory::get_provider_by_doctor_id($doctorId)
            : null;
    }

    /** The appointment's services with their names, as KiviCare's own calendar sync reads them. */
    private function services(int $appointmentId): object
    {
        return \App\models\KCAppointmentServiceMapping::table('asm')
            ->select(['asm.*', 's.name'])
            ->leftJoin(\App\models\KCService::class, 'asm.service_id', '=', 's.id', 's')
            ->where('asm.appointment_id', $appointmentId)
            ->get();
    }

    private function has_calendar_event(int $appointmentId): bool
    {
        global $wpdb;

        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$wpdb->prefix}kc_gcal_appointment_mapping WHERE appointment_id = %d",
            $appointmentId
        )) > 0;
    }
}
