<?php

namespace KCProApp\baseClasses;

use KCProApp\models\KCProChainAuditLog;
use App\models\KCClinic;
use App\models\KCUser;

defined('ABSPATH') or die('Something went wrong');

class KCProChainAuditService
{
    /**
     * @var KCProChainAuditService Instance of this class
     */
    private static $instance = null;

    /**
     * Get singleton instance
     */
    public static function get_instance()
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Logs an action in the Chain lifecycle
     */
    public function log(
        int $chain_id,
        $followup_id,
        string $action_type,
        ?array $old_payload = null,
        ?array $new_payload = null,
        ?string $override_reason = null
    ) {
        $user_id = get_current_user_id();
        $user = new \WP_User($user_id);
        $role_snap = !empty($user->roles) ? implode(', ', $user->roles) : 'system';

        return KCProChainAuditLog::create([
            'chain_id' => $chain_id,
            'followup_id' => $followup_id,
            'user_id' => $user_id,
            'role_snap' => $role_snap,
            'action_type' => $action_type,
            'old_payload' => $old_payload ? json_encode($old_payload) : null,
            'new_payload' => $new_payload ? json_encode($new_payload) : null,
            'override_reason' => $override_reason,
            'created_at_utc' => gmdate('Y-m-d H:i:s')
        ]);
    }
}
