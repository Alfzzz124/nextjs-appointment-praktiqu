<?php
namespace KCProApp\cli;

use KCProApp\models\KCProFollowup;
use KCProApp\models\KCProFollowupActivityLog;
use \DateTimeImmutable;
use \DateTimeZone;

if (!defined('ABSPATH')) {
    exit;
}

/**
 * WP-CLI command for managing KiviCare Follow-ups.
 */
class KCProFollowupCLI
{
    /**
     * Finds follow-ups that have surpassed their suggested_deadline_utc and marks them as missed.
     *
     * ## EXAMPLES
     *
     *     wp kivicare followup process_missed
     *
     * @when after_wp_load
     */
    public function process_missed($args, $assoc_args)
    {
        \WP_CLI::log('Starting process to mark pending follow-ups as missed...');

        global $wpdb;

        $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
        $current_utc_sql = $now->format('Y-m-d H:i:s');

        $missed_followups = KCProFollowup::query()
            ->where('status', 'pending')
            ->where('suggested_deadline_utc', '<', $current_utc_sql)
            ->get();

        if (empty($missed_followups)) {
            \WP_CLI::success('No missed follow-ups found.');
            return;
        }

        $count = count($missed_followups);
        \WP_CLI::log(sprintf('Found %d pending follow-ups that are past their deadline. Processing...', $count));

        $updated_count = 0;

        foreach ($missed_followups as $followup) {
            // Re-fetch using transaction to ensure we have the latest status lock
            try {
                $wpdb->query("START TRANSACTION");

                // Re-fetch object
                $locked_followup = KCProFollowup::find($followup->id);
                // Just use the queried object directly if it hasn't somehow disappeared
                if ($locked_followup && $locked_followup->status !== 'pending') {
                    $locked_followup = null; // simulate it not being pending anymore
                }

                if ($locked_followup) {
                    // Update status
                    $locked_followup->status = 'missed';
                    $locked_followup->updated_at_utc = $current_utc_sql;
                    $locked_followup->updated_by = 0;
                    $locked_followup->save();

                    // Create log entry
                    KCProFollowupActivityLog::create([
                        'followup_id' => $followup->id,
                        'changed_by' => 0, // System
                        'action' => 'status_changed',
                        'old_status' => 'pending',
                        'new_status' => 'missed',
                        'notes' => 'Automatically marked as missed by system cron job.',
                        'created_at' => $current_utc_sql
                    ]);

                    $updated_count++;
                }

                $wpdb->query("COMMIT");
            } catch (\Exception $e) {
                $wpdb->query("ROLLBACK");
                \WP_CLI::warning(sprintf('Failed to process follow-up ID %d: %s', $followup->id, $e->getMessage()));
            }
        }

        \WP_CLI::success(sprintf('Successfully marked %d follow-ups as missed.', $updated_count));
    }
}
