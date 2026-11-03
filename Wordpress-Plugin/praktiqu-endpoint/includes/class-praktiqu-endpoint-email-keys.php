<?php
/**
 * Email placeholders for the client's and the professional's phone number.
 *
 * KiviCare's own {{patient_contact_number}} / {{doctor_contact_number}} come out empty for
 * nearly everyone, because of two bugs in core (still present in 4.5.6):
 *   - KCEmailNotificationInit::fetchAppointmentData fills `contact_number` from
 *     KCPatient/KCDoctor::$contactNumber, which reads the usermeta `contact_number`.
 *     KCPatient::save() never writes that meta; the number lives in the JSON usermeta
 *     `basic_data` → `mobile_number`.
 *   - KCEmailTemplateProcessor::getKeyMapping then maps both keys from `mobile_number`,
 *     a field that data does not have.
 * Those keys are answered before any filter runs, so they cannot be overridden. These are
 * new keys instead, which reach `kivicare_custom_email_key_value` because KiviCare does not
 * know them. Templates have to be switched to them — see
 * docs/deploy/email-phone-keys-runbook.md.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class EmailKeys
{
    public const CLIENT_PHONE       = 'praktiqu_client_phone';
    public const PROFESSIONAL_PHONE = 'praktiqu_professional_phone';

    /** Key → the entry of the appointment email data whose user it belongs to. */
    private const OWNER = [
        self::CLIENT_PHONE       => 'patient',
        self::PROFESSIONAL_PHONE => 'doctor',
    ];

    public function register(): void
    {
        // After KiviCare's own handler (priority 10), which hands unknown keys back as-is.
        add_filter('kivicare_custom_email_key_value', [$this, 'key_value'], 20, 3);

        // The template editor reads this list. `kivicare_register_email_dynamic_keys` looks
        // like the intended hook, but the action that would apply it is never fired.
        add_filter('kivicare_template_dynamic_keys', [$this, 'editor_keys']);
    }

    /**
     * Answers our two keys and passes every other one through.
     *
     * Always a string for our keys: null would send KiviCare on to get_option() and, finding
     * nothing, leave the literal {{praktiqu_client_phone}} in the email.
     *
     * @param mixed $value
     * @param mixed $data
     * @return mixed
     */
    public function key_value($value, $key_name, $data)
    {
        $owner = is_string($key_name) ? (self::OWNER[$key_name] ?? null) : null;
        if ($owner === null) {
            return $value;
        }

        // fetchAppointmentData sets `patient` / `doctor` to null when the user is gone.
        $entry = is_array($data) ? ($data[$owner] ?? null) : null;
        $user_id = is_array($entry) ? absint($entry['id'] ?? 0) : 0;

        return $user_id > 0 ? self::phone_of($user_id) : '';
    }

    /**
     * The `mobile_number` KiviCare keeps in a user's `basic_data`, or '' when it is missing
     * or the JSON is unreadable.
     */
    public static function phone_of(int $user_id): string
    {
        $raw = get_user_meta($user_id, 'basic_data', true);
        $basic = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;
        $phone = is_array($basic) && is_scalar($basic['mobile_number'] ?? null) ? (string) $basic['mobile_number'] : '';

        // KiviCare html_entity_decode()s the whole email after replacing keys, which would
        // undo any escaping, so the value keeps nothing but phone characters.
        return trim((string) preg_replace('/[^0-9+\-\s().]/', '', strip_tags($phone)));
    }

    /**
     * Offers the client phone in every template that offers patient keys, and the
     * professional phone in every template that offers doctor keys.
     *
     * @param mixed $keys template name → list of '{{key}}'
     * @return mixed
     */
    public function editor_keys($keys)
    {
        if (!is_array($keys)) {
            return $keys;
        }

        foreach ($keys as $template => $list) {
            if (!is_array($list)) {
                continue;
            }
            foreach (self::OWNER as $key => $owner) {
                if (self::offers($list, '{{' . $owner . '_') && !in_array('{{' . $key . '}}', $list, true)) {
                    $list[] = '{{' . $key . '}}';
                }
            }
            $keys[$template] = $list;
        }

        return $keys;
    }

    /** @param array<int|string,mixed> $list */
    private static function offers(array $list, string $prefix): bool
    {
        foreach ($list as $key) {
            if (is_string($key) && str_starts_with($key, $prefix)) {
                return true;
            }
        }
        return false;
    }
}
