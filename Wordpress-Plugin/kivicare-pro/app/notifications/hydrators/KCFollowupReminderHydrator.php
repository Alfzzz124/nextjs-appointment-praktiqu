<?php

namespace KCProApp\notifications\hydrators;

use App\models\KCDoctor;
use App\models\KCPatient;
use App\models\KCClinic;
use KCProApp\models\KCProFollowup;
use KCProApp\notifications\KCPNotificationSender;

defined('ABSPATH') or die('Something went wrong');

/**
 * Hydrator for Follow-up Reminder context
 */
class KCFollowupReminderHydrator implements KCNotificationContextHydratorInterface
{
    public function supports(array $context): bool
    {
        return isset($context['followup_id']);
    }

    public function hydrate(string $templateName, array $context, array $options): ?array
    {
        $followupId = (int) ($context['followup_id'] ?? 0);
        if ($followupId <= 0) {
            return null;
        }

        $followup = KCProFollowup::find($followupId);
        if (!$followup) {
            return null;
        }

        $doctor = KCDoctor::find($followup->doctor_id);
        $patient = KCPatient::find($followup->patient_id);
        $clinic = KCClinic::find($followup->clinic_id);

        if (!$patient) {
            return null;
        }

        // Standardized data structure for templates
        $data = [
            'followup' => [
                'id' => $followup->id,
                'reason' => $followup->reason,
                'priority' => $followup->priority,
                'status' => $followup->status,
                'suggested_date' => $followup->suggested_date_utc,
            ],
            // Base properties for flat template access
            'followup_reason'   => $followup->reason,
            'followup_priority' => $followup->priority,
            'suggested_date'    => $followup->suggested_date_utc,
            'clinic_name'       => $clinic ? $clinic->name : get_bloginfo('name'),
        ];

        if ($doctor) {
            $data['doctor'] = [
                'id' => $doctor->id,
                'display_name' => $doctor->displayName,
                'contact_number' => $doctor->contactNumber,
                'email' => $doctor->email,
            ];
            $data['doctor_name'] = $doctor->displayName;
        }

        if ($patient) {
            $data['patient'] = [
                'id' => $patient->id,
                'display_name' => $patient->displayName,
                'contact_number' => $patient->contactNumber,
                'email' => $patient->email,
            ];
            $data['patient_name'] = $patient->displayName;
        }

        if ($clinic) {
            $data['clinic'] = [
                'id' => $clinic->id,
                'name' => $clinic->name,
                'address' => $clinic->clinic_address,
                'contact_number' => $clinic->clinic_contact_number,
                'admin_id' => $clinic->creator_id,
            ];
        }

        if (isset($context['extra_data']) && is_array($context['extra_data'])) {
            $data = array_merge($data, $context['extra_data']);
        }

        $recipientType = (string) ($context['recipient_type'] ?? 'patient');
        $recipientModel = null;
        
        if ($recipientType === 'patient') {
            $recipientModel = $patient;
        } elseif ($recipientType === 'doctor') {
            $recipientModel = $doctor;
        }

        if (!$recipientModel) {
            return null;
        }

        $recipients = [
            'phone'   => $recipientModel->contactNumber ?? '',
            'email'   => $recipientModel->email ?? '',
            'name'    => $recipientModel->displayName ?? '',
            'user_id' => (int) $recipientModel->id
        ];

        return [
            'recipients' => $recipients,
            'data' => $data,
            'options' => $options,
        ];
    }
}
