<?php

namespace KCProApp\baseClasses;

defined('ABSPATH') or die('Something went wrong');

/**
 * KCProFollowupSettings
 *
 * Singleton that reads and caches the saved followup_settings and
 * treatment_chain_settings from the configuration filters.
 * All RBAC guards and business-logic checks in the Pro plugin should
 * obtain settings exclusively through this class to avoid scattered
 * get_option() calls and to benefit from a single cache flush point.
 *
 * Usage:
 *   KCProFollowupSettings::isFollowupEnabled()
 *   KCProFollowupSettings::overdueThresholdDays()
 *   KCProFollowupSettings::receptionistCanSchedule()
 *   KCProFollowupSettings::isChainsEnabled()
 *   KCProFollowupSettings::allowMultipleActive()
 *   KCProFollowupSettings::managementPermission()
 *
 * @package KCProApp\baseClasses
 */
class KCProFollowupSettings
{
    /** @var array|null Cached followup_settings block */
    private static ?array $followupSettings = null;

    /** @var array|null Cached treatment_chain_settings block */
    private static ?array $chainSettings = null;

    // ─── Cache control ────────────────────────────────────────────

    /**
     * Flush cached settings. Call after updating configuration
     * (automatically triggered by the settings save filter if needed).
     */
    public static function flush(): void
    {
        self::$followupSettings = null;
        self::$chainSettings    = null;
    }

    // ─── Internal loaders ─────────────────────────────────────────

    private static function followupSettings(): array
    {
        if (self::$followupSettings === null) {
            /** @var array $raw */
            $raw = apply_filters('kcpro_get_followup_settings', []);
            $rawChannels = $raw['reminder_channels'] ?? ['email'];
            if (!is_array($rawChannels) || empty($rawChannels)) {
                $rawChannels = ['email'];
            }
            self::$followupSettings = [
                'enable_followup'            => (bool) ($raw['enable_followup']            ?? true),
                'overdue_threshold'          => (int)  ($raw['overdue_threshold']          ?? 14),
                'receptionist_can_schedule'  => (bool) ($raw['receptionist_can_schedule']  ?? true),
                'enable_reminder'            => (bool) ($raw['enable_reminder']            ?? true),
                'reminder_days_before'       => (int)  ($raw['reminder_days_before']       ?? 7),
                'reminder_channels'          => array_values($rawChannels),
            ];
        }
        return self::$followupSettings;
    }

    private static function chainSettings(): array
    {
        if (self::$chainSettings === null) {
            /** @var array $raw */
            $raw = apply_filters('kcpro_get_treatment_chain_settings', []);
            self::$chainSettings = [
                'enable_chains'        => (bool)   ($raw['enable_chains']        ?? true),
                'allow_multiple_active'=> (bool)   ($raw['allow_multiple_active']?? false),
                'closure_policy'       => (string) ($raw['closure_policy']       ?? 'manual'),
                'management_permission'=> (string) ($raw['management_permission']?? 'administrator'),
            ];
        }
        return self::$chainSettings;
    }

    // ─── Public API ───────────────────────────────────────────────

    /**
     * Whether the Follow-up Module is globally enabled.
     * When false, all followup endpoints should return 503 / 403.
     */
    public static function isFollowupEnabled(): bool
    {
        return self::followupSettings()['enable_followup'];
    }

    /**
     * Number of days after the suggested deadline before a follow-up
     * is marked overdue. Default: 14.
     */
    public static function overdueThresholdDays(): int
    {
        return self::followupSettings()['overdue_threshold'];
    }

    /**
     * Whether receptionists are allowed to schedule (link) follow-ups
     * to appointments. Default: true.
     */
    public static function receptionistCanSchedule(): bool
    {
        return self::followupSettings()['receptionist_can_schedule'];
    }

    /**
     * Number of days before the suggested date to send the reminder email.
     * Default: 7. Set to 0 to disable automatic reminders.
     */
    public static function reminderDaysBefore(): int
    {
        return self::followupSettings()['reminder_days_before'];
    }

    /**
     * Whether automatic reminders are enabled.
     * When false, no reminder jobs are scheduled regardless of days value.
     */
    public static function isReminderEnabled(): bool
    {
        return self::followupSettings()['enable_reminder'];
    }

    /**
     * Notification channels to use for follow-up reminders.
     * Returns an array of channel keys, e.g. ['email', 'sms'].
     * Default: ['email'].
     *
     * @return string[]
     */
    public static function reminderChannels(): array
    {
        return self::followupSettings()['reminder_channels'];
    }

    /**
     * Whether Treatment Chains are globally enabled.
     * When false, chain creation, listing, and operations are blocked.
     */
    public static function isChainsEnabled(): bool
    {
        return self::chainSettings()['enable_chains'];
    }

    /**
     * Whether a patient may have more than one active chain at a time.
     * Default: false (single-active enforced).
     */
    public static function allowMultipleActive(): bool
    {
        return self::chainSettings()['allow_multiple_active'];
    }

    /**
     * Minimum role required to close or reopen a treatment chain.
     * Returns one of: 'administrator', 'clinic_admin', 'doctor'.
     */
    public static function managementPermission(): string
    {
        return self::chainSettings()['management_permission'];
    }

    /**
     * Closure policy: 'manual' or 'auto'.
     * 'auto' means the chain closes automatically when all followups complete.
     */
    public static function closurePolicy(): string
    {
        return self::chainSettings()['closure_policy'];
    }

    /**
     * Helper: check whether the current WordPress user meets the
     * minimum role tier required by management_permission.
     *
     * Role hierarchy (highest to lowest):
     *   administrator > clinic_admin > doctor > receptionist > patient
     *
     * @return bool
     */
    public static function currentUserHasManagementPermission(): bool
    {
        $required = self::managementPermission();

        // Hierarchy: administrator can always act
        if (current_user_can('administrator')) {
            return true;
        }

        if ($required === 'administrator') {
            return false; // only admins allowed
        }

        // clinic_admin tier
        if (current_user_can('clinic_admin')) {
            return true;
        }

        if ($required === 'clinic_admin') {
            return false; // clinic_admin or above required
        }

        // doctor tier
        if (current_user_can('doctor')) {
            return true;
        }

        return false;
    }
}
