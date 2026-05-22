<?php

namespace KCProApp\baseClasses;

use Exception;
use KCProApp\models\KCProFollowup;
use KCProApp\models\KCProFollowupChain;

defined('ABSPATH') or die('Something went wrong');

class KCProStateTransitionValidator
{
    private const FOLLOWUP_TRANSITIONS = [
        'pending'   => ['scheduled', 'cancelled'],
        'scheduled' => ['completed', 'missed', 'cancelled'],
        'completed' => [],
        'missed'    => [],
        'cancelled' => []
    ];

    private const CHAIN_TRANSITIONS = [
        'active'  => ['on_hold', 'closed'],
        'on_hold' => ['active', 'closed'],
        'closed'  => ['active'] // Reopen
    ];

    public static function validateFollowupTransition(string $current, string $new): void
    {
        if ($current === $new) {
            return;
        }

        if (!isset(self::FOLLOWUP_TRANSITIONS[$current])) {
            throw new Exception("State validation failed: Invalid origin state '{$current}'");
        }

        if (!in_array($new, self::FOLLOWUP_TRANSITIONS[$current], true)) {
            throw new Exception("State validation failed: Cannot transition follow-up from '{$current}' to '{$new}'");
        }
    }

    public static function validateChainTransition(string $current, string $new, ?int $chainId = null): void
    {
        if ($current === $new) {
            return;
        }

        if (!isset(self::CHAIN_TRANSITIONS[$current])) {
            throw new Exception("Chain state validation failed: Invalid origin state '{$current}'");
        }

        if (!in_array($new, self::CHAIN_TRANSITIONS[$current], true)) {
            throw new Exception("Chain state validation failed: Cannot transition chain from '{$current}' to '{$new}'");
        }

        // Rule: Cannot close a chain if there are pending or scheduled follow-ups
        if ($new === 'closed' && $chainId !== null) {
            $pendingCount = KCProFollowup::query()
                ->where('chain_id', $chainId)
                ->where('status', 'pending')
                ->count();
                
            $scheduledCount = KCProFollowup::query()
                ->where('chain_id', $chainId)
                ->where('status', 'scheduled')
                ->count();

            if ($pendingCount > 0 || $scheduledCount > 0) {
                throw new Exception("Chain State Error: Cannot close chain because it contains active follow-ups.");
            }
        }
    }
}
