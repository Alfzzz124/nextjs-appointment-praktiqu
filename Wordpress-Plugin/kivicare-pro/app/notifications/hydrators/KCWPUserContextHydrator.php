<?php

namespace KCProApp\notifications\hydrators;

defined('ABSPATH') or die('Something went wrong');

class KCWPUserContextHydrator implements KCNotificationContextHydratorInterface
{
    public function supports(array $context): bool
    {
        return isset($context['patient_id']) || isset($context['receptionist_id']) || isset($context['clinic_admin_id']) || isset($context['doctor_id']);
    }

    public function hydrate(string $templateName, array $context, array $options): ?array
    {
        $type = null;
        $userId = 0;
        $modelClass = null;

        if (isset($context['patient_id'])) {
            $type = 'patient';
            $userId = (int) $context['patient_id'];
            $modelClass = \App\models\KCPatient::class;
        } elseif (isset($context['receptionist_id'])) {
            $type = 'receptionist';
            $userId = (int) $context['receptionist_id'];
            $modelClass = \App\models\KCReceptionist::class;
        } elseif (isset($context['clinic_admin_id'])) {
            $type = 'clinic_admin';
            $userId = (int) $context['clinic_admin_id'];
            $modelClass = \App\models\KCClinicAdmin::class;
        } elseif (isset($context['doctor_id'])) {
            $type = 'doctor';
            $userId = (int) $context['doctor_id'];
            $modelClass = \App\models\KCDoctor::class;
        }

        if (empty($type) || $userId <= 0 || empty($modelClass)) {
            return null;
        }

        $user = $modelClass::find($userId);
        if (!$user) {
            return null;
        }

        $phone = $user->contactNumber ?? '';
        
        // Fallback to extra_data if phone is empty (e.g. during import when meta might not be saved yet)
        if (empty($phone) && isset($context['extra_data'])) {
            if ($type === 'patient') {
                $phone = $context['extra_data']['patient_phone'] ?? '';
            } elseif ($type === 'receptionist') {
                $phone = $context['extra_data']['receptionist_phone'] ?? '';
            } elseif ($type === 'clinic_admin') {
                $phone = $context['extra_data']['user_phone'] ?? '';
            } elseif ($type === 'doctor') {
                $phone = $context['extra_data']['user_phone'] ?? '';
            }
        }
        
        // Handle admin target for doctor notifications (special case from KCDoctorContextHydrator)
        if ($type === 'doctor' && ($context['target'] ?? null) === 'admin') {
            if (empty($context['admin_email'])) {
                return null;
            }

            $recipients = [
                'email' => (string) ($context['admin_email'] ?? ''),
                'name' => (string) ($context['admin_name'] ?? ''),
                'user_id' => (int) ($context['admin_id'] ?? 0),
            ];
        } else {
            $recipients = [
                'phone' => $phone,
                'email' => $user->email ?? '',
                'name' => $user->displayName ?? '',
                'user_id' => (int) ($user->id ?? $userId),
            ];
        }

        $data = [
            'clinic_name' => get_bloginfo('name'),
        ];

        if ($type === 'patient') {
            $data = array_merge($data, [
                'patient_name' => $user->displayName ?? '',
                'patient_phone' => $user->contactNumber ?? '',
                'user_email' => $user->email ?? '',
            ]);
        } elseif ($type === 'receptionist') {
            $data = array_merge($data, [
                'receptionist_name' => $user->displayName ?? '',
                'receptionist_phone' => $user->contactNumber ?? '',
                'user_email' => $user->email ?? '',
                'user_name' => $user->username ?? '',
            ]);
        } elseif ($type === 'clinic_admin') {
            $data = array_merge($data, [
                'user_email' => $user->email ?? '',
                'user_name' => $user->username ?? ($user->displayName ?? ''),
            ]);
        } elseif ($type === 'doctor') {
            $data = array_merge($data, [
                'doctor_name' => $user->displayName ?? '',
                'doctor_phone' => $user->contactNumber ?? '',
                'doctor_email' => $user->email ?? '',
            ]);
        }

        if (isset($context['extra_data']) && is_array($context['extra_data'])) {
            $data = array_merge($data, $context['extra_data']);
        }

        if (empty($recipients['phone']) && empty($recipients['email'])) {
            return null;
        }

        return [
            'recipients' => $recipients,
            'data' => $data,
            'options' => $options,
        ];
    }
}
