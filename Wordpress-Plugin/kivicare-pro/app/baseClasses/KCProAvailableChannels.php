<?php

namespace KCProApp\baseClasses;

use App\models\KCOption;
use KCProApp\models\KCCustomNotification;

defined('ABSPATH') or die('Something went wrong');

/**
 * KCProAvailableChannels
 *
 * Detects which notification channels are actually configured and active
 * at runtime, so the frontend can render only real options.
 *
 * Channels covered:
 *  - email   → always available (Lite core wp_mail)
 *  - sms     → Twilio SMS configured & enabled
 *  - whatsapp→ Twilio WhatsApp configured & enabled
 *  - custom  → at least one active custom notification service in DB
 *  - push    → Firebase FCM (kivicare-api) credentials configured
 *
 * Usage:
 *   KCProAvailableChannels::get()  → ['email', 'push', ...]
 *   KCProAvailableChannels::all()  → keyed array with label/icon/available
 */
class KCProAvailableChannels
{
    /** @var array<string,array{label:string,available:bool}>|null */
    private static ?array $cache = null;

    /**
     * Flush runtime cache (useful after saving Twilio/Custom settings).
     */
    public static function flush(): void
    {
        self::$cache = null;
    }

    /**
     * Returns an associative map of ALL known channels with availability.
     *
     * @return array<string, array{label: string, available: bool}>
     */
    public static function all(): array
    {
        if (self::$cache !== null) {
            return self::$cache;
        }

        self::$cache = [
            'email' => [
                'label'     => __('Email', 'kivicare-pro'),
                'icon'      => 'ph-envelope',
                'available' => true, // Lite core — always on
            ],
            'push' => [
                'label'     => __('Push Notification', 'kivicare-pro'),
                'icon'      => 'ph-device-mobile',
                'available' => self::isPushConfigured(),
            ],
            'sms' => [
                'label'     => __('SMS (Twilio)', 'kivicare-pro'),
                'icon'      => 'ph-chat-text',
                'available' => self::isSmsConfigured(),
            ],
            'whatsapp' => [
                'label'     => __('WhatsApp (Twilio)', 'kivicare-pro'),
                'icon'      => 'ph-whatsapp-logo',
                'available' => self::isWhatsAppConfigured(),
            ],
            'custom_notification' => [
                'label'     => __('Custom Notification', 'kivicare-pro'),
                'icon'      => 'ph-plugs',
                'available' => self::isCustomConfigured(),
            ],
        ];

        /** Allow third-party plugins to add / toggle channels. */
        self::$cache = apply_filters('kivicare_pro_notification_channel_availability', self::$cache);

        return self::$cache;
    }

    /**
     * Returns only the channel keys that are available.
     *
     * @return string[]
     */
    public static function get(): array
    {
        return array_keys(array_filter(self::all(), fn($c) => $c['available']));
    }

    /**
     * Returns a JSON string of all channel definitions (for module_config injection).
     * Format: [{"key":"email","label":"Email","icon":"ph-envelope","available":true}, ...]
     *
     * @return string
     */
    public static function asJson(): string
    {
        $channels = [];
        foreach (self::all() as $key => $meta) {
            $channels[] = [
                'key'       => $key,
                'label'     => $meta['label'],
                'icon'      => $meta['icon'],
                'available' => $meta['available'],
            ];
        }
        return wp_json_encode($channels);
    }

    // ─── Private detectors ────────────────────────────────────────────────

    /**
     * Check if Twilio SMS is configured and enabled.
     */
    private static function isSmsConfigured(): bool
    {
        $data = KCOption::get('sms_config_data', [], '');
        if (!is_array($data) || empty($data)) {
            return false;
        }

        $enabled = $data['enableSMS'] ?? false;
        $enabled = ($enabled === true || $enabled === 'true' || $enabled === '1' || $enabled === 1);
        if (!$enabled) {
            return false;
        }

        return !empty($data['account_id'])
            && !empty($data['auth_token'])
            && !empty($data['to_number']);
    }

    /**
     * Check if Twilio WhatsApp is configured and enabled.
     */
    private static function isWhatsAppConfigured(): bool
    {
        $data = KCOption::get('whatsapp_config_data', [], '');
        if (!is_array($data) || empty($data)) {
            return false;
        }

        $enabled = $data['enableWhatsApp'] ?? false;
        $enabled = ($enabled === true || $enabled === 'true' || $enabled === '1' || $enabled === 1);
        if (!$enabled) {
            return false;
        }

        return !empty($data['wa_account_id'])
            && !empty($data['wa_auth_token'])
            && !empty($data['wa_from_number']);
    }

    /**
     * Check if at least one Custom notification service is active.
     */
    private static function isCustomConfigured(): bool
    {
        if (!class_exists(KCCustomNotification::class)) {
            return false;
        }
        try {
            $count = KCCustomNotification::query()->where('is_active', 1)->count();
            return $count > 0;
        } catch (\Exception $e) {
            return false;
        }
    }

    /**
     * Check if Firebase FCM push notifications are configured.
     * Requires the kivicare-api plugin to be active and all three
     * Firebase service-account credentials to be present:
     *   privat_key, client_emaail, project_id
     * (field names match what KCPushNotificationSender reads from the DB).
     */
    private static function isPushConfigured(): bool
    {
        // kivicare-api plugin must be active (check for the sender class)
        if (!class_exists('KCApi\\pushNotifications\\KCPushNotificationSender')) {
            return false;
        }

        $config = get_option(KIVI_CARE_PREFIX . 'onesignal_config', []);
        if (!is_array($config) || empty($config)) {
            return false;
        }

        return !empty($config['privat_key'])
            && !empty($config['client_emaail'])
            && !empty($config['project_id']);
    }
}
