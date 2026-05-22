<?php

namespace KCProApp\notifications;

use WP_Error;
use KCProApp\notifications\hydrators\KCAdminDirectContextHydrator;
use KCProApp\notifications\hydrators\KCAppointmentContextHydrator;
use KCProApp\notifications\hydrators\KCNotificationContextHydratorInterface;
use KCProApp\notifications\hydrators\KCWPUserContextHydrator;
use KCProApp\notifications\hydrators\KCFollowupReminderHydrator;
use App\baseClasses\KCErrorLogger;

defined('ABSPATH') or die('Something went wrong');

/**
 * Notification Manager - Handles scheduling notifications via WooCommerce Action Scheduler
 */
class KCPNotificationManager
{
    private static ?KCPNotificationManager $instance = null;

    public static function get_instance(): KCPNotificationManager
    {
        if (!isset(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Schedule a notification using WooCommerce Action Scheduler
     * 
     * @param string $templateName
     * @param array $context Context data containing IDs (e.g., ['appointment_id' => 123, 'recipient_type' => 'patient'])
     * @param array $options
     * @param int $delay
     */
    public function schedule_notification(string $templateName, array $context, array $options = [], int $delay = 0): array
    {

        $hook = 'kivicare_pro_execute_notification';
        $args = [
            'templateName' => $templateName,
            'context' => $context,
            'options' => $options
        ];
        
        // Use as_enqueue_async_action for background processing
        as_enqueue_async_action($hook, $args, 'kivicare-notifications');
        
        return ['status' => 'scheduled'];
    }

    /**
     * Execute a scheduled notification. This is the callback for the action scheduler.
     */
    public function execute_scheduled_notification($templateNameOrArgs, $context = [], $options = []): void
    {

        $templateName = '';
        $normalizedContext = [];
        $normalizedOptions = [];

        if (is_array($templateNameOrArgs)) {
            // Single payload array.
            $templateName = (string) ($templateNameOrArgs['templateName'] ?? '');
            $normalizedContext = is_array($templateNameOrArgs['context'] ?? null) ? $templateNameOrArgs['context'] : [];
            $normalizedOptions = is_array($templateNameOrArgs['options'] ?? null) ? $templateNameOrArgs['options'] : [];
        } elseif (is_string($templateNameOrArgs) && is_array($context) && is_array($options)) {
            // Normal Action Scheduler call: ($templateName, $context, $options)
            $templateName = $templateNameOrArgs;
            $normalizedContext = $context;
            $normalizedOptions = $options;
        } elseif (is_string($templateNameOrArgs)) {
            // Legacy/alternate: single JSON string.
            $decoded = json_decode($templateNameOrArgs, true);
            if (is_array($decoded)) {
                $templateName = (string) ($decoded['templateName'] ?? '');
                $normalizedContext = is_array($decoded['context'] ?? null) ? $decoded['context'] : [];
                $normalizedOptions = is_array($decoded['options'] ?? null) ? $decoded['options'] : [];
            } else {
                $templateName = $templateNameOrArgs;
            }
        }

        $context = $normalizedContext;
        $options = $normalizedOptions;


        $hydration = $this->hydrateNotificationPayload($templateName, $context, $options);
        if (empty($hydration)) {
            return;
        }

        $recipients = $hydration['recipients'] ?? [];
        $data = $hydration['data'] ?? [];
        $options = $hydration['options'] ?? $options;

        if (empty($recipients) || empty($data)) {
            return;
        }
        KCPNotificationSender::get_instance()->execute_notification(
            $templateName,
            $recipients,
            $data,
            $options
        );
    }

    /**
     * @return array{recipients: array, data: array, options: array}|null
     */
    private function hydrateNotificationPayload(string $templateName, array $context, array $options): ?array
    {
        /** @var KCNotificationContextHydratorInterface[] $hydrators */
        $hydrators = [
            new KCAppointmentContextHydrator(),
            new KCAdminDirectContextHydrator(),
            new KCWPUserContextHydrator(),
            new KCFollowupReminderHydrator(),
        ];

        foreach ($hydrators as $hydrator) {
            try {
                if (!$hydrator->supports($context)) {
                    continue;
                }

                $payload = $hydrator->hydrate($templateName, $context, $options);
                if (!empty($payload)) {
                    return $payload;
                }
            } catch (\Throwable $e) {
                KCErrorLogger::instance()->error('KCPNotificationManager: hydrator error in ' . get_class($hydrator) . ' - ' . $e->getMessage());
            }
        }

        return null;
    }
}