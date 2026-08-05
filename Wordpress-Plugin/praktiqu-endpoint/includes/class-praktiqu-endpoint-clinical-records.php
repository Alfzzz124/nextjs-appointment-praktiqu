<?php
/**
 * An encounter's children: medical history entries and prescriptions.
 *
 * Both tables have the same shape — a row hanging off an encounter, attributed to a
 * clinician, with `is_from_template` recording whether it came from a template:
 *
 *   wp_kc_medical_history  (type ∈ problem|observation|note, title)
 *   wp_kc_prescription     (name, frequency, duration, instruction)
 *
 * `type` is KiviCare's own vocabulary, taken from MedicalHistoryController.php:214-218.
 * It is what replaced our SOAP sections: KiviCare's UI, encounter templates and print
 * views all understand these three, and understood nothing of SOAP.
 *
 * Neither table has a KiviCare hook — MedicalHistoryController writes rows directly and
 * fires nothing — so these are plain writes. That is the same evidence-based exception
 * already made for clinic sessions and off-days: a direct write here skips no listener.
 * The encounter itself is different and goes through Encounters, which does fire hooks.
 *
 * Writes are replace-the-set rather than per-row CRUD, because that is how the callers
 * use them: editing a session note rewrites its entries wholesale. It also makes a
 * retried write idempotent instead of duplicating entries.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class ClinicalRecords
{
    /** KiviCare's medical-history vocabulary (MedicalHistoryController.php:214-218). */
    public const TYPES = ['problem', 'observation', 'note'];

    /**
     * Replace this encounter's medical history entries.
     *
     * @param array<int,array<string,mixed>> $entries each {type, title}
     * @return array<string,mixed>|\WP_Error
     */
    public function replace_history(int $encounter_id, int $patient_id, array $entries, int $added_by): array|\WP_Error
    {
        foreach ($entries as $i => $entry) {
            $type = (string) ($entry['type'] ?? '');
            if (!in_array($type, self::TYPES, true)) {
                return new \WP_Error(
                    'praktiqu_invalid_history_type',
                    sprintf('entries[%d].type must be one of: %s', $i, implode(', ', self::TYPES)),
                    ['status' => 400]
                );
            }
        }

        global $wpdb;
        $table = $wpdb->prefix . 'kc_medical_history';

        $wpdb->delete($table, ['encounter_id' => $encounter_id], ['%d']);

        $written = 0;
        foreach ($entries as $entry) {
            $title = trim((string) ($entry['title'] ?? ''));
            if ($title === '') {
                // An empty entry carries nothing and would render as a blank row in
                // KiviCare's encounter view.
                continue;
            }
            $ok = $wpdb->insert($table, [
                'encounter_id'     => $encounter_id,
                'patient_id'       => $patient_id,
                'type'             => (string) $entry['type'],
                'title'            => sanitize_textarea_field($title),
                'added_by'         => $added_by,
                'created_at'       => current_time('mysql'),
                'is_from_template' => 0,
            ], ['%d', '%d', '%s', '%s', '%d', '%s', '%d']);
            if ($ok) {
                $written++;
            }
        }

        return ['encounter_id' => $encounter_id, 'entries' => $written];
    }

    /**
     * Replace this encounter's prescriptions.
     *
     * @param array<int,array<string,mixed>> $items each {name, frequency, duration, instruction}
     * @return array<string,mixed>|\WP_Error
     */
    public function replace_prescriptions(int $encounter_id, int $patient_id, array $items, int $added_by): array|\WP_Error
    {
        global $wpdb;
        $table = $wpdb->prefix . 'kc_prescription';

        $wpdb->delete($table, ['encounter_id' => $encounter_id], ['%d']);

        $written = [];
        foreach ($items as $item) {
            $name = trim((string) ($item['name'] ?? ''));
            if ($name === '') {
                continue;
            }
            $ok = $wpdb->insert($table, [
                'encounter_id'     => $encounter_id,
                'patient_id'       => $patient_id,
                'name'             => sanitize_textarea_field($name),
                // varchar(199) in KiviCare's schema — truncate rather than let MySQL
                // reject the row in strict mode.
                'frequency'        => mb_substr(sanitize_text_field((string) ($item['frequency'] ?? '')), 0, 199),
                'duration'         => mb_substr(sanitize_text_field((string) ($item['duration'] ?? '')), 0, 199),
                'instruction'      => sanitize_textarea_field((string) ($item['instruction'] ?? '')),
                'added_by'         => $added_by,
                'created_at'       => current_time('mysql'),
                'is_from_template' => 0,
            ], ['%d', '%d', '%s', '%s', '%s', '%s', '%d', '%s', '%d']);
            if ($ok) {
                $written[] = (int) $wpdb->insert_id;
            }
        }

        return ['encounter_id' => $encounter_id, 'ids' => $written];
    }

    /* -------------------------------------------------------------- */
    /* Reads used to build the encounter-closed notification           */
    /* -------------------------------------------------------------- */

    /**
     * The encounter's notes as one block of text, for the close notification.
     * Problems and observations are included: the patient's copy should carry what was
     * found, not only what was written under "note".
     */
    public function notes_text(int $encounter_id): string
    {
        global $wpdb;
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT type, title FROM {$wpdb->prefix}kc_medical_history
                  WHERE encounter_id = %d ORDER BY id ASC",
                $encounter_id
            )
        );
        if (!$rows) {
            return '';
        }

        $lines = [];
        foreach ($rows as $row) {
            $title = trim((string) $row->title);
            if ($title === '') {
                continue;
            }
            $lines[] = ucfirst((string) $row->type) . ': ' . $title;
        }
        return implode("\n", $lines);
    }

    /**
     * The encounter's prescriptions as one block of text, for the close notification.
     */
    public function prescription_text(int $encounter_id): string
    {
        global $wpdb;
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT name, frequency, duration, instruction FROM {$wpdb->prefix}kc_prescription
                  WHERE encounter_id = %d ORDER BY id ASC",
                $encounter_id
            )
        );
        if (!$rows) {
            return '';
        }

        $lines = [];
        foreach ($rows as $row) {
            $parts = array_filter([
                trim((string) $row->name),
                trim((string) $row->frequency),
                trim((string) $row->duration),
                trim((string) $row->instruction),
            ], static fn ($p) => $p !== '');
            if ($parts !== []) {
                $lines[] = implode(' — ', $parts);
            }
        }
        return implode("\n", $lines);
    }
}
