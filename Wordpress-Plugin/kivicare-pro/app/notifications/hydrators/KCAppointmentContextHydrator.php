<?php

namespace KCProApp\notifications\hydrators;

use KCProApp\notifications\KCPNotificationSender;

defined('ABSPATH') or die('Something went wrong');

class KCAppointmentContextHydrator implements KCNotificationContextHydratorInterface
{
    public function supports(array $context): bool
    {
        return isset($context['appointment_id']);
    }

    public function hydrate(string $templateName, array $context, array $options): ?array
    {
        $appointmentId = (int) ($context['appointment_id'] ?? 0);
        if ($appointmentId <= 0) {
            return null;
        }

        $appointmentListener = \App\emails\listeners\KCAppointmentNotificationListener::get_instance();
        $appointmentData = $appointmentListener->getAppointmentDataForEmail($appointmentId);

        if (empty($appointmentData) || !is_array($appointmentData)) {
            return null;
        }

        $recipientType = (string) ($context['recipient_type'] ?? 'patient');
        $recipients = KCPNotificationSender::get_instance()->getRecipientFromAppointmentData($appointmentData, $recipientType);
        if (empty($recipients) || !is_array($recipients)) {
            return null;
        }

        $data = $appointmentData;
        if (isset($context['extra_data']) && is_array($context['extra_data'])) {
            $data = array_merge($data, $context['extra_data']);
        }

        return [
            'recipients' => $recipients,
            'data' => $data,
            'options' => $options,
        ];
    }
}
