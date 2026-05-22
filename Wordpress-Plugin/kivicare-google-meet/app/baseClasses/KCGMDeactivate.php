<?php

namespace KCGMApp\baseClasses;

defined('ABSPATH') or die('Something went wrong');

class KCGMDeactivate
{
    public static function deactivate()
    {
        // delete_option(KIVICARE_GOOGLE_MEET_PREFIX . 'google_meet_setting');
        wp_cache_flush();
    }
}