<?php

namespace Tests\Feature;

use App\Services\ApiException;
use App\Services\PraktiquApi;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

// Galat 5xx dari backend diganti pemanggil dengan pesan ramah berbahasa
// Indonesia, jadi kalau tidak dicatat di sini penyebab aslinya hilang total.
class PraktiquApiLoggingTest extends TestCase
{
    public function test_it_logs_a_5xx_from_the_backend(): void
    {
        Http::fake([
            '*/api/v1/auth/login' => Http::response([
                'title' => 'Internal Server Error',
                'code' => 'boom',
                'detail' => 'database is on fire',
            ], 500),
        ]);

        Log::shouldReceive('warning')
            ->once()
            ->withArgs(fn (string $msg, array $ctx) => str_contains($msg, 'POST /api/v1/auth/login')
                && str_contains($msg, '500')
                && $ctx['code'] === 'boom'
                && $ctx['detail'] === 'database is on fire');

        $this->expectException(ApiException::class);

        app(PraktiquApi::class)->post('api/v1/auth/login', ['email' => 'a@b.co', 'password' => 'x']);
    }

    public function test_it_stays_quiet_for_a_rejected_credential(): void
    {
        // 401 = password salah. Wajar, bukan insiden — kalau ikut dicatat,
        // log produksi tenggelam oleh salah ketik pengguna.
        Http::fake([
            '*/api/v1/auth/login' => Http::response(['detail' => 'Email or password is incorrect'], 401),
        ]);

        Log::shouldReceive('warning')->never();

        $this->expectException(ApiException::class);

        app(PraktiquApi::class)->post('api/v1/auth/login', ['email' => 'a@b.co', 'password' => 'x']);
    }
}
