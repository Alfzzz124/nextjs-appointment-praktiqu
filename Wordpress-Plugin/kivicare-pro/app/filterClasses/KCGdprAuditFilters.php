<?php

namespace KCProApp\filterClasses;

use App\baseClasses\KCBase;
use KCProApp\listeners\KCGdprMutationListener;
use KCProApp\listeners\KCGdprAuthListener;

if (!defined('ABSPATH')) {
    exit;
}

class KCGdprAuditFilters extends KCBase
{
    public function __construct()
    {
        // GDPR Audit Log - Hook into mutation events for patients
        add_action('kivicare_after_user_register', [KCGdprMutationListener::class, 'logCreate'], 10, 2);
        
        // Note: appointment CRUD is fully covered by KCGdprRequestListener (REST API lifecycle).
        // The previous action hooks (kc_after_create_appointment etc.) caused duplicate log entries
        // and have been removed.

        // GDPR Audit Log - Hook into WordPress Auth events
        add_action('wp_login', [KCGdprAuthListener::class, 'logLogin'], 10, 2);
        add_action('wp_logout', [KCGdprAuthListener::class, 'logLogout'], 10, 1);
        add_action('wp_login_failed', [KCGdprAuthListener::class, 'logLoginFailed'], 10, 2);
    }
}
