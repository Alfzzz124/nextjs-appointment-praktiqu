<?php
/**
 * Plugin Name: PraktiQU Endpoint (mu-loader)
 * Description: Must-use loader for the folder-based "PraktiQU Endpoint" plugin.
 *              WordPress does not auto-load plugins that live in a subdirectory
 *              of wp-content/mu-plugins/, so this root-level stub requires the
 *              real plugin bootstrap. Upload BOTH this file and the
 *              praktiqu-endpoint/ folder into wp-content/mu-plugins/.
 * Version:     1.1.0
 * Author:      PraktiQU Team
 *
 * Resulting layout on the server:
 *   wp-content/mu-plugins/
 *   ├── praktiqu-endpoint-loader.php   ← this file (auto-loaded by WP)
 *   └── praktiqu-endpoint/             ← the whole plugin folder
 *       ├── praktiqu-endpoint.php
 *       └── includes/...
 */

defined('ABSPATH') || exit;

$praktiqu_endpoint_main = __DIR__ . '/praktiqu-endpoint/praktiqu-endpoint.php';

if (is_readable($praktiqu_endpoint_main)) {
    require_once $praktiqu_endpoint_main;
}
