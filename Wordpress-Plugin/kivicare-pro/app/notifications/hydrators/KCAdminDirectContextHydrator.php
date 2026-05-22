<?php

namespace KCProApp\notifications\hydrators;

defined('ABSPATH') or die('Something went wrong');

class KCAdminDirectContextHydrator implements KCNotificationContextHydratorInterface
{
    public function supports(array $context): bool
    {
        return ($context['target'] ?? null) === 'admin' && !empty($context['admin_email']);
    }

    public function hydrate(string $templateName, array $context, array $options): ?array
    {
        $recipients = [
            'email' => (string) ($context['admin_email'] ?? ''),
            'name' => (string) ($context['admin_name'] ?? ''),
            'user_id' => (int) ($context['admin_id'] ?? 0),
        ];

        $data = [
            'clinic_name' => get_bloginfo('name'),
        ];

        if (isset($context['extra_data']) && is_array($context['extra_data'])) {
            $data = array_merge($data, $context['extra_data']);
        }

        if (empty($recipients['email'])) {
            return null;
        }

        return [
            'recipients' => $recipients,
            'data' => $data,
            'options' => $options,
        ];
    }
}
