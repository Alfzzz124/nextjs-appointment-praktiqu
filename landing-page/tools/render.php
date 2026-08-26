<?php
// Render satu halaman WP (termasuk draft) dari CLI. Read-only: tidak menulis apa pun.
if ($argc < 2) { fwrite(STDERR, "usage: php render.php <post_id>\n"); exit(2); }
$id = (int) $argv[1];

$_SERVER['HTTP_HOST']       = 'appointment.praktiqu.com';
$_SERVER['REQUEST_METHOD']  = 'GET';
$_SERVER['SERVER_PROTOCOL'] = 'HTTP/1.1';
$_SERVER['SERVER_NAME']     = 'appointment.praktiqu.com';
$_SERVER['HTTPS']           = 'on';
$_SERVER['SERVER_PORT']     = '443';
$_SERVER['REQUEST_URI']     = '/?page_id=' . $id . '&preview=true';
$_SERVER['QUERY_STRING']    = 'page_id=' . $id . '&preview=true';
$_GET = ['page_id' => (string) $id, 'preview' => 'true'];
$_REQUEST = $_GET;

// Hook pra-boot: WP mengubah $wp_filter mentah jadi WP_Hook saat plugin.php dimuat.
// Perlu supaya halaman draft lolos pemeriksaan kapabilitas sebelum query jalan.
$GLOBALS['wp_filter'] = [
  'plugins_loaded' => [ 0 => [ [ 'accepted_args' => 0, 'function' => function () { wp_set_current_user(1); } ] ] ],
  // Halaman publish kalau diminta lewat ?page_id= akan di-redirect ke permalink cantiknya
  // dan body-nya kosong. Batalkan supaya satu metode berlaku untuk draft & publish.
  'redirect_canonical' => [ 10 => [ [ 'accepted_args' => 2, 'function' => '__return_false' ] ] ],
  // Kita login sebagai admin supaya draft terbaca — efek sampingnya WordPress
  // menempelkan admin bar: markup, CSS, JS, plus avatar gravatar si admin.
  // Semua itu sampah untuk sebuah template landing page.
  'show_admin_bar' => [ 10 => [ [ 'accepted_args' => 1, 'function' => '__return_false' ] ] ],
];

define('WP_USE_THEMES', true);
chdir(__DIR__ . '/appointment.praktiqu.com');
require __DIR__ . '/appointment.praktiqu.com/index.php';
