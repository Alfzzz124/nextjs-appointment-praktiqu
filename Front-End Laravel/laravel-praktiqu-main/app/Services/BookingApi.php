<?php

namespace App\Services;

use Illuminate\Support\Str;

// Jembatan API booking publik (/api/v1/public/*) ke bentuk tenant/psy yang
// dikonsumsi UI booking — port dari lib/booking-api.js FE lama. Tanpa
// mock/dummy: kalau API gagal, pemanggil menerima null dan UI menampilkan
// error state.
class BookingApi
{
    private const TYPE_LABEL = [
        'PSIKOLOG_KLINIS' => 'Psikolog Klinis',
        'PSIKOLOG_ANAK' => 'Psikolog Anak',
        'PSIKIATER' => 'Psikiater',
        'KONSELOR' => 'Konselor',
    ];

    // Kata umum di nama praktik/gelar yang tidak boleh dianggap kecocokan nama.
    private const GENERIC_TOKENS = ['praktik', 'praktek', 'psikolog', 'psikologi', 'klinik', 'psi', 'mpsi', 'spsi', 'trial', 'test'];

    public function __construct(private readonly PraktiquApi $api)
    {
    }

    public static function slugify(?string $name): string
    {
        return trim(preg_replace('/-+/', '-', preg_replace('/[^a-z0-9]+/', '-', strtolower($name ?? ''))), '-');
    }

    private static function asArray(mixed $v): array
    {
        if (is_array($v)) {
            foreach (['items', 'data', 'slots'] as $k) {
                if (isset($v[$k]) && is_array($v[$k]) && array_is_list($v[$k])) {
                    return $v[$k];
                }
            }
            if (array_is_list($v)) {
                return $v;
            }
        }

        return [];
    }

    private static function initialsOf(?string $name): string
    {
        $words = array_slice(preg_split('/\s+/', trim($name ?? '')) ?: [], 0, 2);
        $init = strtoupper(implode('', array_map(fn ($w) => mb_substr($w, 0, 1), $words)));

        return $init !== '' ? $init : '?';
    }

    private function mapService(array $s): array
    {
        $typeLabel = self::TYPE_LABEL[$s['serviceType'] ?? ''] ?? null;

        return [
            'id' => (string) $s['id'],
            'apiId' => (string) $s['id'],
            'name' => $s['name'] ?? '',
            'desc' => $s['description'] ?? ($typeLabel ? 'Layanan '.strtolower($typeLabel) : ''),
            'dur' => ($s['durationMinutes'] ?? 60).' menit',
            'price' => (float) ($s['price'] ?? 0),
        ];
    }

    // API publik belum bisa memfilter professionals per practice, jadi pasangan
    // klinik->psikolog dicari dari nama. TANPA fallback sembarang: kalau tidak
    // ada yang cocok, kembalikan null (empty state, bukan data palsu).
    private function matchProfessional(array $pros, array $practice): ?array
    {
        $compact = str_replace('-', '', self::slugify($practice['name'] ?? ''));
        $best = null;
        $bestScore = 0;
        foreach ($pros as $pro) {
            $tokens = array_filter(
                explode('-', self::slugify($pro['fullName'] ?? '')),
                fn ($w) => strlen($w) >= 3 && ! in_array($w, self::GENERIC_TOKENS, true)
            );
            $score = count(array_filter($tokens, fn ($t) => str_contains($compact, $t)));
            if ($score > $bestScore) {
                $best = $pro;
                $bestScore = $score;
            }
        }

        return $best;
    }

    // Resolve tenant dari slug URL: practice.id/name dulu, lalu
    // professional.id/fullName (nama di-slugify) — sama dengan acuan DB di
    // PLANNING-MAPPING-API.md repo FE.
    public function resolveTenant(string $slug): ?array
    {
        try {
            try {
                $practices = self::asArray($this->api->get('api/v1/public/practices'));
            } catch (ApiException) {
                $practices = [];
            }
            $pros = self::asArray($this->api->get('api/v1/public/professionals'));

            $practice = collect($practices)->first(fn ($p) => (string) ($p['id'] ?? '') === $slug)
                ?? collect($practices)->first(fn ($p) => self::slugify($p['name'] ?? '') === $slug);

            $professional = $practice
                ? $this->matchProfessional($pros, $practice)
                : (collect($pros)->first(fn ($p) => (string) ($p['id'] ?? '') === $slug)
                    ?? collect($pros)->first(fn ($p) => self::slugify($p['fullName'] ?? '') === $slug));

            $services = null;
            if ($professional) {
                try {
                    $raw = $this->api->get('api/v1/public/professionals/'.rawurlencode($professional['id']).'/services');
                    $services = array_map(fn ($s) => $this->mapService($s), self::asArray($raw));
                } catch (ApiException $e) {
                    logger()->warning('[booking-api] services error: '.$e->getMessage());
                }
            }
        } catch (ApiException $e) {
            logger()->error('[booking-api] resolveTenant error: '.$e->getMessage());

            return null;
        }

        if (! $practice && ! $professional) {
            return null;
        }

        $proName = $professional['fullName'] ?? $practice['name'] ?? $slug;
        $clinicName = $practice['name'] ?? $proName;
        $prices = array_filter(array_map(fn ($s) => $s['price'], $services ?? []), fn ($p) => $p > 0);

        // URL kanonik = nama entitas di-slugify (nama klinik kalau ada practice,
        // kalau tidak nama psikolog). Fallback ke id numerik hanya kalau nama
        // tidak menghasilkan slug (mis. semua simbol). Dipakai controller untuk
        // mengalihkan /4 → /azanidianda-com supaya URL menampilkan nama klinik.
        $canonicalName = $practice ? $clinicName : $proName;
        $canonicalId = $practice ? (string) $practice['id'] : ($professional ? (string) $professional['id'] : $slug);
        $canonicalSlug = self::slugify($canonicalName) ?: $canonicalId;

        return [
            'slug' => $slug,
            'canonicalSlug' => $canonicalSlug,
            'apiId' => $practice ? (string) $practice['id'] : null,
            'name' => $clinicName,
            'tagline' => $practice['address'] ?? '',
            'city' => $practice['city'] ?? '',
            'init' => self::initialsOf($clinicName),
            'services' => $services ?: null,
            'psy' => [
                'apiId' => $professional ? (string) $professional['id'] : null,
                'name' => $proName,
                'init' => self::initialsOf($proName),
                'spec' => self::TYPE_LABEL[$professional['professionalType'] ?? ''] ?? '',
                'bio' => $professional['biography'] ?? '',
                'price' => $prices ? min($prices) : 0,
                'nextAvailable' => $professional['nextAvailable'] ?? null,
                // Field UI yang tidak dikirim API dibiarkan kosong (bukan karangan).
                'exp' => '', 'rate' => '', 'reviews' => 0, 'sessions' => '', 'c' => '#425FAD',
                'focus' => array_values(array_filter(array_map(
                    fn ($s) => is_array($s) ? ($s['label'] ?? $s['name'] ?? null) : $s,
                    $professional['specialties'] ?? []
                ))),
            ],
        ];
    }

    // Jam slot ("HH:MM") satu psikolog pada satu tanggal.
    public function fetchSlots(string $professionalId, string $dateIso): array
    {
        try {
            $raw = $this->api->get(
                'api/v1/public/professionals/'.rawurlencode($professionalId).'/slots',
                ['date' => $dateIso]
            );
            $times = collect(self::asArray($raw))
                ->map(fn ($x) => is_string($x) ? $x : ($x['startTime'] ?? $x['time'] ?? null))
                ->filter()
                ->map(fn ($t) => substr($t, 0, 5))
                ->unique()->sort()->values()->all();

            return ['times' => $times, 'live' => true];
        } catch (ApiException $e) {
            logger()->error('[booking-api] fetchSlots error: '.$e->getMessage());

            return ['times' => [], 'live' => false, 'error' => $e->getMessage()];
        }
    }

    // Submit booking final: hold slot dulu, lalu buat appointment.
    // `token` = token appointment bertandatangan; hanya token ini yang diterima
    // endpoint pembayaran/pembatalan publik — jangan pakai id/reference.
    public function submitBooking(array $slot, array $client): array
    {
        $hold = $this->api->post('api/v1/public/booking/hold', $slot);
        $holdKey = $hold['holdKey'] ?? $hold['key'] ?? null;

        $res = $this->api->post('api/v1/public/appointments', array_merge($slot, $client, ['holdKey' => $holdKey]));

        $a = $res['appointment'] ?? [];
        $token = $res['token'] ?? $res['appointmentToken'] ?? $res['bookingToken'] ?? $res['accessToken']
            ?? $a['token'] ?? $a['appointmentToken'] ?? null;
        $code = $token ?? $res['code'] ?? $res['bookingCode'] ?? $res['reference'] ?? $res['id'] ?? $a['id'] ?? null;
        if (! $code) {
            throw new ApiException('Booking berhasil dikirim tetapi tidak mendapat kode konfirmasi.', 502, $res);
        }
        if (! $token) {
            logger()->warning('[booking-api] respons appointment tanpa token — pembayaran dinonaktifkan.', ['keys' => array_keys((array) $res)]);
        }

        return ['code' => (string) $code, 'token' => $token];
    }

    // Mulai checkout. 409 = order pending sudah ada — bukan kegagalan,
    // pemanggil tinggal poll status via checkPayment().
    public function startPayment(string $token): array
    {
        try {
            $res = $this->api->post('api/v1/public/payments', ['token' => $token]);
            $checkoutUrl = $res['checkoutUrl'] ?? $res['data']['checkoutUrl'] ?? null;
            if (! $checkoutUrl) {
                throw new ApiException('Backend tidak mengembalikan tautan pembayaran.', 502, $res);
            }

            return ['checkoutUrl' => $checkoutUrl, 'pending' => false];
        } catch (ApiException $e) {
            if ($e->status === 409) {
                return ['checkoutUrl' => null, 'pending' => true];
            }
            throw $e;
        }
    }

    // Status pembayaran terkini — ditulis webhook; redirect browser dari
    // checkout TIDAK pernah dianggap bukti bayar, jadi UI wajib poll ini.
    public function checkPayment(string $token): ?array
    {
        try {
            $res = $this->api->post('api/v1/public/payment-verify', ['token' => $token]);
            $view = isset($res['status']) ? $res : ($res['data'] ?? null);

            // Backend mengirim status huruf besar ("PENDING"), sedangkan seluruh
            // UI membandingkan huruf kecil — tanpa normalisasi di sini polling
            // tidak pernah start dan banner status kehilangan label/warnanya.
            // Dinormalkan di satu titik ini supaya UI tak perlu tahu casing upstream.
            return isset($view['status'])
                ? ['status' => strtolower(trim((string) $view['status'])), 'expectedAmount' => (float) ($view['expectedAmount'] ?? 0)]
                : null;
        } catch (ApiException $e) {
            if ($e->status === 404) {
                return null; // belum ada order pembayaran
            }
            logger()->error('[booking-api] checkPayment error: '.$e->getMessage());

            return null;
        }
    }
}
