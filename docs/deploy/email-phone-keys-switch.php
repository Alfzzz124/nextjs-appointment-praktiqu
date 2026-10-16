<?php
/**
 * Switches KiviCare email templates from the phone placeholders that always come out
 * empty to the ones praktiqu-endpoint (>= 1.8.1) answers:
 *
 *   {{patient_contact_number}} → {{praktiqu_client_phone}}
 *   {{doctor_contact_number}}  → {{praktiqu_professional_phone}}
 *
 * Read docs/deploy/email-phone-keys-runbook.md first. Run from a shell, never from the web:
 *
 *   php email-phone-keys-switch.php <wp-root>                          dry run, writes nothing
 *   php email-phone-keys-switch.php <wp-root> --apply --ids=47,54,60   back up, then switch
 *   php email-phone-keys-switch.php <wp-root> --restore=<backup.json>  put the old content back
 *
 * Writes post_content with $wpdb instead of wp_update_post(): with no logged-in user,
 * wp_update_post() runs the content through kses, which can strip markup from a template.
 * Compatible with PHP 7.4 on purpose — the CLI binary on the host may be older than the web one.
 */

if (PHP_SAPI !== 'cli') {
    exit(1);
}

const PRAKTIQU_SWAP = [
    'patient_contact_number' => 'praktiqu_client_phone',
    'doctor_contact_number'  => 'praktiqu_professional_phone',
];
const PRAKTIQU_POST_TYPE = 'kivicare_mail_tmp';

function praktiqu_fail(string $message): void
{
    fwrite(STDERR, "ERROR: {$message}\n");
    exit(1);
}

/** KiviCare trims inside the braces, so {{ patient_contact_number }} counts as well. */
function praktiqu_pattern(string $key): string
{
    return '/\{\{\s*' . preg_quote($key, '/') . '\s*\}\}/';
}

function praktiqu_switched(string $content): string
{
    foreach (PRAKTIQU_SWAP as $from => $to) {
        $content = (string) preg_replace(praktiqu_pattern($from), '{{' . $to . '}}', $content);
    }
    return $content;
}

/** @return array<string,int> key → occurrences */
function praktiqu_counts(string $content): array
{
    $counts = [];
    foreach (array_merge(array_keys(PRAKTIQU_SWAP), array_values(PRAKTIQU_SWAP)) as $key) {
        $counts[$key] = preg_match_all(praktiqu_pattern($key), $content);
    }
    return $counts;
}

function praktiqu_show(object $post, string $content): void
{
    echo "#{$post->ID} {$post->post_name} ({$post->post_status})\n";
    foreach (praktiqu_counts($content) as $key => $n) {
        if ($n > 0) {
            echo '    {{' . $key . '}} × ' . $n . "\n";
        }
    }
    foreach (array_keys(PRAKTIQU_SWAP) as $key) {
        if (preg_match_all(praktiqu_pattern($key), $content, $m, PREG_OFFSET_CAPTURE) > 0) {
            foreach ($m[0] as [, $offset]) {
                $start = max(0, $offset - 50);
                echo '    … ' . str_replace(["\r", "\n"], ' ', substr($content, $start, 110)) . " …\n";
            }
        }
    }
}

$root = null;
$apply = false;
$ids = [];
$restore = null;
foreach (array_slice($argv, 1) as $arg) {
    if ($arg === '--apply') {
        $apply = true;
    } elseif (strpos($arg, '--ids=') === 0) {
        $ids = array_values(array_unique(array_filter(array_map('intval', explode(',', substr($arg, 6))))));
    } elseif (strpos($arg, '--restore=') === 0) {
        $restore = substr($arg, 10);
    } elseif ($root === null && strpos($arg, '--') !== 0) {
        $root = rtrim($arg, '/');
    } else {
        praktiqu_fail("Unknown argument: {$arg}");
    }
}
if ($root === null || !is_file($root . '/wp-load.php')) {
    praktiqu_fail('Usage: php email-phone-keys-switch.php <wp-root> [--apply --ids=47,54,60 | --restore=<backup.json>]');
}
if ($apply && $ids === []) {
    praktiqu_fail('--apply needs --ids=… taken from the dry run.');
}

require $root . '/wp-load.php';
global $wpdb;

if ($restore !== null) {
    $raw = is_file($restore) ? file_get_contents($restore) : false;
    $entries = $raw === false ? null : json_decode($raw, true);
    if (!is_array($entries)) {
        praktiqu_fail("Cannot read backup {$restore}");
    }
    foreach ($entries as $entry) {
        $id = (int) ($entry['ID'] ?? 0);
        $updated = $wpdb->update(
            $wpdb->posts,
            ['post_content' => (string) $entry['post_content']],
            ['ID' => $id, 'post_type' => PRAKTIQU_POST_TYPE]
        );
        clean_post_cache($id);
        echo $updated === false ? "#{$id} FAILED: {$wpdb->last_error}\n" : "#{$id} {$entry['post_name']} restored\n";
    }
    exit(0);
}

$candidates = $wpdb->get_results($wpdb->prepare(
    "SELECT ID, post_name, post_status, post_modified, post_content FROM {$wpdb->posts}
     WHERE post_type = %s AND (post_content LIKE %s OR post_content LIKE %s) ORDER BY ID",
    PRAKTIQU_POST_TYPE,
    '%' . $wpdb->esc_like('patient_contact_number') . '%',
    '%' . $wpdb->esc_like('doctor_contact_number') . '%'
));
$by_id = [];
foreach ($candidates as $post) {
    if (praktiqu_switched($post->post_content) !== $post->post_content) {
        $by_id[(int) $post->ID] = $post;
    }
}

if (!$apply) {
    echo "Templates using a broken phone key (" . count($by_id) . "):\n";
    foreach ($by_id as $post) {
        praktiqu_show($post, $post->post_content);
    }
    echo "\nDry run — nothing written. Re-run with --apply --ids=" . implode(',', array_keys($by_id)) . "\n";
    exit(0);
}

$unknown = array_diff($ids, array_keys($by_id));
if ($unknown !== []) {
    praktiqu_fail('Not a template with a broken phone key: #' . implode(', #', $unknown) . '. Nothing written.');
}

// The backup goes to disk before the first write, and a failed backup stops the run.
$backup = [];
foreach ($ids as $id) {
    $post = $by_id[$id];
    $backup[] = [
        'ID'            => (int) $post->ID,
        'post_name'     => $post->post_name,
        'post_status'   => $post->post_status,
        'post_modified' => $post->post_modified,
        'post_content'  => $post->post_content,
    ];
}
$json = json_encode($backup, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$backup_file = __DIR__ . '/email-phone-keys-backup-' . gmdate('Ymd\THis\Z') . '.json';
if ($json === false || file_put_contents($backup_file, $json) !== strlen($json)) {
    praktiqu_fail("Could not write backup {$backup_file}. Nothing written.");
}
chmod($backup_file, 0600);
echo "Backup: {$backup_file}\n";

foreach ($ids as $id) {
    $post = $by_id[$id];
    $new = praktiqu_switched($post->post_content);
    // Matching on the old content too: a template edited since the read above is skipped,
    // not overwritten.
    $updated = $wpdb->update(
        $wpdb->posts,
        [
            'post_content'      => $new,
            'post_modified'     => current_time('mysql'),
            'post_modified_gmt' => current_time('mysql', true),
        ],
        ['ID' => $id, 'post_type' => PRAKTIQU_POST_TYPE, 'post_content' => $post->post_content]
    );
    clean_post_cache($id);

    if ($updated === false) {
        echo "#{$id} FAILED: {$wpdb->last_error}\n";
    } elseif ($updated === 0) {
        echo "#{$id} SKIPPED: changed since it was read\n";
    } else {
        $now = get_post($id);
        praktiqu_show($now, (string) $now->post_content);
    }
}
