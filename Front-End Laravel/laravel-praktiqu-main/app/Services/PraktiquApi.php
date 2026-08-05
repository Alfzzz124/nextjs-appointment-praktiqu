<?php

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Session;

// Klien tipis untuk backend PraktiQU /api/v1 — port dari lib/api.js FE lama.
//
// Perbedaan dengan versi Next.js: token disimpan di session server (bukan
// localStorage), dan semua request keluar dari PHP sehingga tidak perlu proxy
// same-origin. Dua konvensi respons backend tetap dinormalkan oleh unwrap():
// modul KC memakai amplop {status,message,data}, modul standar mengembalikan
// entity langsung (error RFC-7807 problem+json).
class PraktiquApi
{
    public const TOKEN_KEY = 'pq_token';
    public const REFRESH_KEY = 'pq_refresh';
    public const PROFILE_KEY = 'pq_profile';

    // Endpoint auth/publik: 401 di sini berarti kredensial salah, bukan sesi
    // kedaluwarsa — jangan coba refresh.
    private const NO_REFRESH = ['api/v1/auth/login', 'api/v1/auth/refresh', 'api/v1/public/'];

    // ── Ketahanan terhadap pemblokiran backend ──────────────────────────
    // Inilah inti "agar tidak terblokir". Karena semua request keluar dari
    // server Laravel (bukan browser), CORS & WAF-edge yang dulu memblokir FE
    // Next.js sudah lenyap. Yang tersisa hanya penolakan sesaat dari backend:
    //   415 → WAF hosting menolak request SEBELUM sampai ke aplikasi (aman
    //         diulang; request tidak pernah diproses).
    //   429 → rate limit; hormati header Retry-After lalu ulang.
    //   502/503/504 → galat gateway; aplikasi belum tentu memproses, aman
    //         diulang termasuk untuk POST.
    //   500 → aplikasi menerima lalu error; HANYA diulang untuk method
    //         idempoten (GET/HEAD/PUT/DELETE), tidak untuk POST (bisa dobel).
    private const RETRY_ALL_METHODS = [415, 429, 502, 503, 504];
    private const RETRY_IDEMPOTENT_ONLY = [500];
    private const IDEMPOTENT = ['GET', 'HEAD', 'PUT', 'DELETE'];
    private const MAX_ATTEMPTS = 3;

    private function shouldRetry(string $method, int $status): bool
    {
        if (in_array($status, self::RETRY_ALL_METHODS, true)) {
            return true;
        }
        if (in_array($status, self::RETRY_IDEMPOTENT_ONLY, true)) {
            return in_array(strtoupper($method), self::IDEMPOTENT, true);
        }

        return false;
    }

    private function backoffMs(Response $res, int $attempt): int
    {
        // Hormati Retry-After (detik) kalau backend mengirimnya (khas 429).
        $retryAfter = $res->header('Retry-After');
        if (is_numeric($retryAfter)) {
            return min((int) $retryAfter * 1000, 5000);
        }

        return 250 * (2 ** $attempt); // 250ms, 500ms, 1000ms…
    }

    private function base(): string
    {
        return rtrim(config('praktiqu.base'), '/');
    }

    private function unwrap(mixed $json): mixed
    {
        if (is_array($json) && array_key_exists('data', $json)) {
            if (array_key_exists('status', $json) || array_key_exists('message', $json)) {
                return $json['data'];
            }
            if (count($json) === 1) {
                return $json['data'];
            }
        }

        return $json;
    }

    // Satu kali kirim, tanpa retry. connectTimeout dipisah supaya backend yang
    // menggantung tidak menyandera worker sampai timeout total.
    private function dispatch(string $method, string $path, array $query, mixed $body, ?string $bearer): Response
    {
        $req = Http::connectTimeout(10)->timeout(30)->acceptJson();
        if ($bearer) {
            $req = $req->withToken($bearer);
        }

        $url = $this->base().'/'.ltrim($path, '/');

        return match (strtoupper($method)) {
            'GET' => $req->get($url, $query),
            'DELETE' => $req->delete($url.($query ? '?'.http_build_query($query) : ''), $body ?? []),
            default => $req->withQueryParameters($query)->{strtolower($method)}($url, $body ?? []),
        };
    }

    // Kirim dengan retry+backoff untuk penolakan sesaat backend (lihat
    // konstanta RETRY_* di atas). ConnectionException (timeout/DNS/koneksi
    // putus SEBELUM ada respons) juga diulang untuk method idempoten & POST —
    // aman karena berarti request belum diproses.
    private function send(string $method, string $path, array $query, mixed $body, ?string $bearer): Response
    {
        $attempt = 0;
        while (true) {
            try {
                $res = $this->dispatch($method, $path, $query, $body, $bearer);
            } catch (ConnectionException $e) {
                if ($attempt >= self::MAX_ATTEMPTS - 1) {
                    logger()->warning('[praktiqu-api] '.strtoupper($method)." /{$path} → tidak terhubung setelah ".self::MAX_ATTEMPTS.' percobaan', [
                        'detail' => $e->getMessage(),
                    ]);

                    throw new ApiException('Tidak dapat menghubungi server. Coba lagi.', 0, null);
                }
                usleep(250_000 * (2 ** $attempt));
                $attempt++;

                continue;
            }

            if ($attempt >= self::MAX_ATTEMPTS - 1 || ! $this->shouldRetry($method, $res->status())) {
                return $res;
            }
            usleep($this->backoffMs($res, $attempt) * 1000);
            $attempt++;
        }
    }

    // accessToken berumur pendek; saat 401, tukar refreshToken lalu ulangi
    // sekali (API-ACCESS-GUIDE.md §7 — jangan login ulang, kena rate limit).
    private function refreshAccessToken(): ?string
    {
        $refresh = Session::get(self::REFRESH_KEY);
        if (! $refresh) {
            return null;
        }

        $res = Http::timeout(30)->acceptJson()
            ->post($this->base().'/api/v1/auth/refresh', ['refreshToken' => $refresh]);
        if (! $res->ok()) {
            return null;
        }

        $data = $this->unwrap($res->json()) ?: [];
        $access = $data['accessToken'] ?? $data['token'] ?? null;
        if (! $access) {
            return null;
        }

        Session::put(self::TOKEN_KEY, $access);
        if (! empty($data['refreshToken'])) {
            Session::put(self::REFRESH_KEY, $data['refreshToken']);
        }

        return $access;
    }

    public function clearSession(): void
    {
        Session::forget([self::TOKEN_KEY, self::REFRESH_KEY, self::PROFILE_KEY]);
    }

    /**
     * @throws ApiException saat respons bukan 2xx
     */
    public function call(string $method, string $path, array $query = [], mixed $body = null, ?string $token = null): mixed
    {
        $path = ltrim($path, '/');
        $query = array_filter($query, fn ($v) => $v !== null && $v !== '');
        $bearer = $token ?? Session::get(self::TOKEN_KEY);

        $res = $this->send($method, $path, $query, $body, $bearer);

        $noRefresh = $token !== null
            || collect(self::NO_REFRESH)->contains(fn ($p) => str_starts_with($path, $p));
        if ($res->status() === 401 && ! $noRefresh) {
            $fresh = $this->refreshAccessToken();
            if ($fresh) {
                $res = $this->send($method, $path, $query, $body, $fresh);
            } else {
                // Sesi mati: bersihkan supaya tidak "menempel"; middleware /
                // controller yang mengarahkan pengguna kembali ke login.
                $this->clearSession();
            }
        }

        $json = $res->json();
        if (! $res->successful()) {
            $msg = is_array($json)
                ? ($json['message'] ?? $json['detail'] ?? $json['title'] ?? "HTTP {$res->status()}")
                : "HTTP {$res->status()}";

            // 4xx = penolakan wajar (password salah, token kedaluwarsa) dan
            // bukan insiden. 5xx justru perlu jejak: pemanggil menggantinya
            // dengan pesan ramah, jadi tanpa baris ini galat asli backend
            // hilang total dan kejadiannya tidak bisa ditelusuri belakangan.
            if ($res->status() >= 500) {
                logger()->warning('[praktiqu-api] '.strtoupper($method)." /{$path} → {$res->status()}", [
                    'code' => is_array($json) ? ($json['code'] ?? null) : null,
                    'detail' => is_array($json) ? ($json['detail'] ?? $json['message'] ?? null) : null,
                ]);
            }

            throw new ApiException($msg, $res->status(), $json);
        }

        return $this->unwrap($json);
    }

    public function get(string $path, array $query = []): mixed
    {
        return $this->call('GET', $path, $query);
    }

    public function post(string $path, mixed $body = null, array $query = []): mixed
    {
        return $this->call('POST', $path, $query, $body);
    }

    /**
     * Jalankan beberapa panggilan dengan paralelisme terbatas.
     * Backend staging cuma punya 3 koneksi MySQL (host max 5/user) — menembak
     * 10+ request serentak membuat semua endpoint 500, jadi dibatasi 2
     * seperti allSettledLimit di lib/dashboard-api.js FE lama.
     *
     * @param  array<string, callable():mixed>  $tasks
     * @return array<string, array{ok: bool, value?: mixed, error?: ApiException}>
     */
    public function allSettled(array $tasks, int $limit = 2): array
    {
        // PHP sinkron: "paralelisme terbatas" berarti berurutan — yang penting
        // TIDAK serentak, sehingga batas koneksi DB backend tetap aman.
        $out = [];
        foreach ($tasks as $key => $fn) {
            try {
                $out[$key] = ['ok' => true, 'value' => $fn()];
            } catch (ApiException $e) {
                $out[$key] = ['ok' => false, 'error' => $e];
            }
        }

        return $out;
    }
}
