<?php
/**
 * Assertions for EmailKeys — the {{praktiqu_client_phone}} / {{praktiqu_professional_phone}}
 * placeholders. Plain PHP — no PHPUnit, no real WordPress — runs in a bare `php:8.4-cli`
 * container, same as the other files in this directory.
 *
 * Why they exist: KiviCare's own {{patient_contact_number}} is empty for almost every
 * patient, twice over. Its appointment email data reads the usermeta `contact_number`,
 * which KCPatient::save() never writes (the number lives in `basic_data` →
 * `mobile_number`), and its template processor then maps the key from `mobile_number`
 * anyway, which that data does not have. Both live in core, so the fix is a key of our own.
 *
 * add_filter / apply_filters (with priorities, as KiviCare registers its own handler at 10)
 * and get_user_meta are shimmed over plain arrays.
 */

declare(strict_types=1);

namespace {
    use PraktiQU\Endpoint\EmailKeys;

    define('ABSPATH', __DIR__ . '/');

    function add_filter(string $hook, callable $callback, int $priority = 10, int $accepted_args = 1): void
    {
        $GLOBALS['filters'][$hook][$priority][] = [$callback, $accepted_args];
    }

    function apply_filters(string $hook, $value, ...$args)
    {
        $by_priority = $GLOBALS['filters'][$hook] ?? [];
        ksort($by_priority);
        foreach ($by_priority as $callbacks) {
            foreach ($callbacks as [$callback, $accepted]) {
                $value = $callback(...array_slice([$value, ...$args], 0, $accepted));
            }
        }
        return $value;
    }

    function absint($value): int
    {
        return abs((int) $value);
    }

    function do_shortcode(string $content): string
    {
        return $content;
    }

    function get_option(string $name, $default = false)
    {
        return $default;
    }

    /** Like WordPress: '' for a user or key that does not exist, when $single is true. */
    function get_user_meta(int $user_id, string $key = '', bool $single = false)
    {
        return $GLOBALS['usermeta'][$user_id][$key] ?? '';
    }

    function reset_world(): void
    {
        $GLOBALS['filters'] = [];
        $GLOBALS['usermeta'] = [
            1035 => ['basic_data' => json_encode(['mobile_number' => '0812-3456-7890', 'gender' => 'female'])],
            142  => ['basic_data' => json_encode(['mobile_number' => '+62 811 2222 333'])],
            501  => ['basic_data' => ''],
            502  => ['basic_data' => '{"mobile_number": "0812'],
            503  => ['basic_data' => json_encode(['gender' => 'male'])],
            504  => ['basic_data' => json_encode(['mobile_number' => ['0812']])],
            505  => ['basic_data' => json_encode(['mobile_number' => '<img src=x onerror=alert(1)>0812 777'])],
            506  => ['basic_data' => json_encode('0812')],
        ];

        // KiviCare's own handler (KCEmailNotificationInit::handleCustomEmailKeys): answers a
        // few computed keys at priority 10 and hands every other key back untouched.
        add_filter('kivicare_custom_email_key_value', static function (?string $value, string $keyName, array $data): ?string {
            return $keyName === 'clinic_full_address' ? 'Jl. Kivi 1' : $value;
        }, 10, 3);

        (new EmailKeys())->register();
    }

    /** What KCEmailTemplateProcessor::getCustomKeyValue asks for. */
    function key_value(string $key, array $data)
    {
        return apply_filters('kivicare_custom_email_key_value', null, $key, $data);
    }

    /** The shape KCEmailNotificationInit::fetchAppointmentData hands the processor. */
    function appointment_data(?int $patient_id, ?int $doctor_id): array
    {
        return [
            'appointment' => ['id' => 3358],
            'patient' => $patient_id === null ? null : ['id' => $patient_id, 'contact_number' => null],
            'doctor'  => $doctor_id === null ? null : ['id' => $doctor_id, 'contact_number' => null],
        ];
    }

    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-email-keys.php';

    $failures = 0;

    function check(string $label, $actual, $expected): void
    {
        global $failures;
        if ($actual === $expected) {
            echo "  ok   {$label}\n";
            return;
        }
        $failures++;
        echo "  FAIL {$label}\n";
        echo "       expected: " . var_export($expected, true) . "\n";
        echo "       actual:   " . var_export($actual, true) . "\n";
    }

    echo "Phone present in basic_data\n";
    reset_world();
    check('client phone', key_value('praktiqu_client_phone', appointment_data(1035, 142)), '0812-3456-7890');
    check('professional phone', key_value('praktiqu_professional_phone', appointment_data(1035, 142)), '+62 811 2222 333');
    check('id given as a string, as the model may hand it', key_value('praktiqu_client_phone', ['patient' => ['id' => '1035']]), '0812-3456-7890');

    echo "\nbasic_data empty or broken → empty string, never null\n";
    // null would fall through to get_option() and leave {{praktiqu_client_phone}} in the mail.
    reset_world();
    check('basic_data empty', key_value('praktiqu_client_phone', appointment_data(501, 142)), '');
    check('basic_data truncated JSON', key_value('praktiqu_client_phone', appointment_data(502, 142)), '');
    check('basic_data without mobile_number', key_value('praktiqu_client_phone', appointment_data(503, 142)), '');
    check('mobile_number not a string', key_value('praktiqu_client_phone', appointment_data(504, 142)), '');
    check('basic_data JSON but not an object', key_value('praktiqu_client_phone', appointment_data(506, 142)), '');
    check('user without any basic_data', key_value('praktiqu_professional_phone', appointment_data(1035, 777)), '');

    echo "\nNo patient / professional in the data\n";
    check('patient null (deleted patient)', key_value('praktiqu_client_phone', appointment_data(null, 142)), '');
    check('professional null', key_value('praktiqu_professional_phone', appointment_data(1035, null)), '');
    check('patient id 0', key_value('praktiqu_client_phone', appointment_data(0, 142)), '');
    check('no patient key at all (a non-appointment email)', key_value('praktiqu_client_phone', ['user' => ['id' => 9]]), '');
    check('patient is not an array', key_value('praktiqu_client_phone', ['patient' => 'Siti']), '');

    echo "\nOnly phone characters reach the email\n";
    // KCEmailTemplateProcessor html_entity_decode()s the whole mail after replacing keys,
    // so escaping would be undone; markup has to be gone from the value itself.
    $dirty = key_value('praktiqu_client_phone', appointment_data(505, 142));
    check('no markup survives', strpbrk($dirty, '<>"=') === false, true);
    check('the number is kept', str_ends_with($dirty, '0812 777'), true);

    echo "\nEvery other key is left alone\n";
    check('KiviCare\'s broken key is not hijacked', key_value('patient_contact_number', appointment_data(1035, 142)), null);
    check('KiviCare\'s own computed key still answers', key_value('clinic_full_address', appointment_data(1035, 142)), 'Jl. Kivi 1');
    check('a value an earlier filter gave is passed through', apply_filters('kivicare_custom_email_key_value', 'dari filter lain', 'some_other_key', []), 'dari filter lain');

    echo "\nTemplate editor lists the keys\n";
    reset_world();
    $keys = apply_filters('kivicare_template_dynamic_keys', [
        'kivicare_doctor_book_appointment' => ['{{appointment_date}}', '{{patient_name}}', '{{patient_email}}'],
        'kivicare_book_appointment'        => ['{{patient_name}}', '{{doctor_name}}'],
        'kivicare_patient_register'        => ['{{user_name}}', '{{user_password}}'],
    ]);
    check('a template offering patient keys gets the client phone', in_array('{{praktiqu_client_phone}}', $keys['kivicare_doctor_book_appointment'], true), true);
    check('…and not the professional phone it has no professional for', in_array('{{praktiqu_professional_phone}}', $keys['kivicare_doctor_book_appointment'], true), false);
    check('a template offering both gets both', array_values(array_intersect($keys['kivicare_book_appointment'], ['{{praktiqu_client_phone}}', '{{praktiqu_professional_phone}}'])), ['{{praktiqu_client_phone}}', '{{praktiqu_professional_phone}}']);
    check('a registration template is untouched', $keys['kivicare_patient_register'], ['{{user_name}}', '{{user_password}}']);
    $twice = apply_filters('kivicare_template_dynamic_keys', $keys);
    check('applying twice adds nothing', $twice, $keys);
    check('a list that is not an array is passed through', apply_filters('kivicare_template_dynamic_keys', 'rusak'), 'rusak');

    echo "\nThrough KiviCare's own KCEmailTemplateProcessor (the copy vendored in this repo)\n";
    $kivicare = __DIR__ . '/../../kivicare-clinic-management-system/app';
    if (!is_file($kivicare . '/emails/KCEmailTemplateProcessor.php')) {
        echo "  skip KiviCare is not next to this plugin\n";
    } else {
        require_once $kivicare . '/baseClasses/KCNotificationDynamicKeys.php';
        require_once $kivicare . '/emails/KCEmailTemplateProcessor.php';

        reset_world();
        $processor = new \App\emails\KCEmailTemplateProcessor();
        $data = appointment_data(1035, 142);
        $data['patient']['email'] = 'siti@contoh.id';

        // Template #47 (kivicare_doctor_book_appointment) on prod, before and after the switch.
        check(
            'KiviCare\'s own key comes out empty — the bug',
            $processor->processTemplate('<p> Client email {{patient_email}}</p><p> Client Phone number:  {{patient_contact_number}}</p>', $data),
            '<p> Client email siti@contoh.id</p><p> Client Phone number:  </p>'
        );
        check(
            'our key carries the number',
            $processor->processTemplate('<p> Client email {{patient_email}}</p><p> Client Phone number:  {{praktiqu_client_phone}}</p>', $data),
            '<p> Client email siti@contoh.id</p><p> Client Phone number:  0812-3456-7890</p>'
        );
        check(
            'the professional\'s too',
            $processor->processTemplate('Nomor profesional: {{praktiqu_professional_phone}}', $data),
            'Nomor profesional: +62 811 2222 333'
        );
        check(
            'a missing number leaves no placeholder behind',
            $processor->processTemplate('HP: {{praktiqu_client_phone}}.', appointment_data(501, 142)),
            'HP: .'
        );
    }

    echo "\n";
    if ($failures > 0) {
        echo "{$failures} FAILURE(S)\n";
        exit(1);
    }
    echo "ALL PASS\n";
}
