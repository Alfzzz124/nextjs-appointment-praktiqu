<?php

namespace App\Http\Controllers;

use App\Services\ApiException;
use App\Services\PraktiquApi;
use Illuminate\Http\Request;

// Menulis CRUD dashboard ke backend /api/v1 yang asli.
//
// Keamanan: TIDAK jadi proxy terbuka. Hanya pasangan entitas→endpoint di
// allowlist RESOURCES yang boleh dipanggil, dan hanya aksi yang terdaftar.
// Token JWT staf dilampirkan otomatis oleh PraktiquApi dari session.
//
// Catatan bentuk payload: spec backend generik (type: object), jadi nama field
// create adalah tebakan terbaik dari bentuk respons yang sudah diamati. Kalau
// backend membalas 422/validasi, pesannya diteruskan APA ADANYA ke UI supaya
// nama field yang benar langsung ketahuan dan bisa disetel.
class ResourceController extends Controller
{
    private const RESOURCES = [
        'patients' => [
            'create' => ['POST', 'api/v1/clients'],
            'delete' => ['DELETE', 'api/v1/clients/{id}'],
            'status' => ['PATCH', 'api/v1/clients/{id}/status'],
        ],
        'doctors' => [
            'create' => ['POST', 'api/v1/professionals'],
            'delete' => ['DELETE', 'api/v1/professionals/{id}'],
            'status' => ['PATCH', 'api/v1/professionals/{id}/status'],
        ],
        'receptionists' => [
            'create' => ['POST', 'api/v1/receptionists'],
            'delete' => ['DELETE', 'api/v1/receptionists/{id}'],
        ],
        'billing' => [
            'create' => ['POST', 'api/v1/bills'],
            'delete' => ['DELETE', 'api/v1/bills/{id}'],
        ],
        'clinics' => [
            'create' => ['POST', 'api/v1/practices'],
            'delete' => ['DELETE', 'api/v1/practices/{id}'],
        ],
        'sessions' => [
            'create' => ['POST', 'api/v1/doctor-sessions'],
            'delete' => ['DELETE', 'api/v1/doctor-sessions/{id}'],
        ],
    ];

    public function __construct(private readonly PraktiquApi $api)
    {
    }

    // "Rp425.000" / "425.000" → 425000
    private static function parseMoney(mixed $v): int
    {
        return (int) preg_replace('/\D/', '', (string) $v);
    }

    // FE form → payload backend (tebakan terbaik dari bentuk respons teramati).
    private function payload(string $resource, array $form): array
    {
        return match ($resource) {
            'patients' => array_filter([
                'name' => $form['name'] ?? null,
                'email' => $form['email'] ?? null,
                'mobile' => $form['mobile'] ?? null,
            ]),
            'doctors' => array_filter([
                'fullName' => $form['name'] ?? null,
                'email' => $form['email'] ?? null,
                'mobile' => $form['mobile'] ?? null,
            ]),
            'receptionists' => array_filter([
                'name' => $form['name'] ?? null,
                'email' => $form['email'] ?? null,
                'mobile' => $form['mobile'] ?? null,
            ]),
            'billing' => array_filter([
                'clientName' => $form['name'] ?? null,
                'description' => $form['service'] ?? null,
                'totalAmount' => isset($form['total']) ? self::parseMoney($form['total']) : null,
                'paymentStatus' => ($form['status'] ?? null) === 'Lunas' ? 'paid' : 'unpaid',
            ]),
            'clinics' => array_filter([
                'name' => $form['name'] ?? null,
                'address' => $form['address'] ?? null,
                'telephoneNo' => $form['phone'] ?? null,
                'ownerPhoto' => $form['ownerPhoto'] ?? null,
            ]),
            'sessions' => array_filter([
                'professionalName' => $form['name'] ?? null,
                'mode' => $form['mode'] ?? null,
                'startTime' => explode(' - ', (string) ($form['hours'] ?? ''))[0] ?? null,
                'endTime' => explode(' - ', (string) ($form['hours'] ?? ''))[1] ?? null,
                'capacity' => isset($form['capacity']) ? (int) $form['capacity'] : null,
                'activeDays' => $form['activeDays'] ?? null,
            ]),
            default => $form,
        };
    }

    public function create(Request $request, string $resource)
    {
        [$method, $path] = $this->route($resource, 'create');

        try {
            $created = $this->api->call($method, $path, [], $this->payload($resource, $request->all()));

            return response()->json([
                'ok' => true,
                'id' => is_array($created) ? ($created['id'] ?? $created['data']['id'] ?? null) : null,
            ]);
        } catch (ApiException $e) {
            return $this->error($e);
        }
    }

    public function destroy(string $resource, string $id)
    {
        [$method, $path] = $this->route($resource, 'delete');

        try {
            $this->api->call($method, str_replace('{id}', rawurlencode($id), $path));

            return response()->json(['ok' => true]);
        } catch (ApiException $e) {
            return $this->error($e);
        }
    }

    public function status(Request $request, string $resource, string $id)
    {
        [$method, $path] = $this->route($resource, 'status');
        $active = $request->boolean('active');

        try {
            $this->api->call($method, str_replace('{id}', rawurlencode($id), $path), [], [
                'status' => $active ? 'active' : 'inactive',
            ]);

            return response()->json(['ok' => true]);
        } catch (ApiException $e) {
            return $this->error($e);
        }
    }

    /** @return array{0:string,1:string} */
    private function route(string $resource, string $action): array
    {
        $def = self::RESOURCES[$resource][$action] ?? null;
        abort_unless($def, 404, "Aksi tidak dikenal: {$resource}.{$action}");

        return $def;
    }

    private function error(ApiException $e)
    {
        // 501 = endpoint masih stub di backend; beri pesan yang jelas.
        $msg = $e->status === 501
            ? 'Fitur ini belum diaktifkan di server (endpoint masih stub).'
            : ($e->getMessage() ?: 'Gagal menyimpan ke server.');

        return response()->json(['ok' => false, 'message' => $msg, 'status' => $e->status], 200);
    }
}
