<?php
/**
 * Jobs_Webhook — mengirim callback penyelesaian job dari Action Scheduler ke Next.js.
 *
 * Terpisah dari `Hooks::dispatch_webhook` dengan sengaja, karena keduanya bicara dalam
 * dua kontrak berbeda. `dispatch_webhook` mengirim event user dengan payload DATAR
 * (`{event, wpUserId, issuedAt, source, ...}`). Penerima job di Next.js
 * (`src/app/api/v1/webhooks/wordpress-jobs/route.ts` -> `processWebhook`) membaca
 * `payload.event` lalu memanggil `handler(payload.data)`, jadi ia butuh `data` bersarang.
 * Memakai ulang pengirim yang datar akan menyerahkan `undefined` ke handler.
 *
 * URL dan rahasianya juga milik sendiri, bukan berbagi dengan event user: merotasi
 * rahasia event user tidak boleh mematikan callback job tanpa suara.
 *
 * `build_body()` dan `sign()` sengaja bebas dari WordPress supaya kontrak kabelnya bisa
 * diuji di container PHP kosong (tests/test-jobs-webhook.php) alih-alih hanya lewat
 * Action Scheduler yang hidup — pola yang sama, dan alasan yang sama, seperti Money.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

// Harness test mendefinisikan PRAKTIQU_ENDPOINT_JOBS_WEBHOOK_TEST supaya berkas ini bisa
// di-require di luar WordPress. Di luar itu, tanpa ABSPATH tetap berhenti.
defined('ABSPATH') || defined('PRAKTIQU_ENDPOINT_JOBS_WEBHOOK_TEST') || exit;

final class Jobs_Webhook
{
    public const URL_OPTION    = 'praktiqu_endpoint_jobs_webhook_url';
    public const SECRET_OPTION = 'praktiqu_endpoint_jobs_webhook_secret';

    /**
     * Bentuk body yang dibaca `processWebhook` di Next.js: `{ event, data }`.
     *
     * Memakai `json_encode`, bukan `wp_json_encode`, supaya fungsi ini bisa diuji tanpa
     * WordPress. Body-nya kita susun sendiri dari nilai skalar, jadi tidak ada yang
     * dibutuhkan dari pembungkus WordPress-nya.
     *
     * `data` di-cast ke object supaya array kosong terbit sebagai `{}`, bukan `[]` —
     * `handler(payload.data)` di sisi Next.js mengharapkan objek.
     */
    public static function build_body(string $event, array $data): string|false
    {
        return json_encode([
            'event' => $event,
            'data'  => (object) $data,
        ]);
    }

    /**
     * HMAC-SHA256 hex atas body mentah — persis yang dihitung `verifyWebhookSignature()`
     * di `src/lib/jobs/webhook-handler.ts` sebelum membandingkannya dengan timingSafeEqual.
     *
     * Rahasia kosong menghasilkan tanda tangan kosong, meniru `dispatch_webhook`. Sisi
     * Next.js menolak permintaan tanpa tanda tangan saat rahasianya terpasang.
     */
    public static function sign(string $body, string $secret): string
    {
        return $secret !== '' ? hash_hmac('sha256', $body, $secret) : '';
    }

    /**
     * Kirim satu callback. Fire-and-forget: kegagalan jaringan tidak boleh menjatuhkan
     * eksekusi action, dan Action Scheduler tidak punya siapa pun untuk dikabari.
     */
    public function send(string $event, array $data): void
    {
        $url = (string) get_option(self::URL_OPTION, '');
        if ($url === '') {
            return; // Belum dikonfigurasi; no-op tanpa suara, sama seperti dispatch_webhook.
        }

        $body = self::build_body($event, $data);
        if ($body === false) {
            return;
        }

        $secret = (string) get_option(self::SECRET_OPTION, '');

        $response = wp_remote_post($url, [
            'method'      => 'POST',
            'timeout'     => 5,
            'redirection' => 0,
            'headers'     => [
                'Content-Type'                 => 'application/json',
                'X-PraktiQU-Webhook-Event'     => $event,
                'X-PraktiQU-Webhook-Signature' => self::sign($body, $secret),
            ],
            'body'     => $body,
            'blocking' => false,
        ]);

        if (is_wp_error($response)) {
            error_log('[praktiqu-endpoint] jobs webhook failed: ' . $response->get_error_message());
        }
    }
}
