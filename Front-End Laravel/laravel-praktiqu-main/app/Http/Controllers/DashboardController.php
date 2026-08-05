<?php

namespace App\Http\Controllers;

use App\Services\BookingApi;
use App\Services\PraktiquApi;
use Illuminate\Support\Facades\Session;

// Dashboard staf (super/admin/psikolog) — port dari lib/dashboard-api.js +
// components/dashboard/DashboardApp.js loadData(). Semua data diambil dari
// API di sisi server, dipetakan defensif (field tak dikenal jadi "—"), lalu
// diserahkan ke Blade sebagai payload untuk Alpine.
class DashboardController extends Controller
{
    private const AVATAR_COLORS = ['#7A8AD0', '#C58A2E', '#8A6BB0', '#3B7CA8', '#1F8A5B', '#C56A6A', '#425FAD'];

    public function __construct(private readonly PraktiquApi $api)
    {
    }

    // ── Helpers ────────────────────────────────────────────────────────

    private static function pick(array $r, array $keys): mixed
    {
        foreach ($keys as $k) {
            $v = data_get($r, $k);
            if ($v !== null && $v !== '') {
                return $v;
            }
        }

        return null;
    }

    private static function asArray(mixed $v): array
    {
        if (is_array($v)) {
            foreach (['items', 'data'] as $k) {
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

    private static function color(): string
    {
        return self::AVATAR_COLORS[array_rand(self::AVATAR_COLORS)];
    }

    private static function rp(float $n): string
    {
        return 'Rp'.number_format($n, 0, ',', '.');
    }

    private static function compactRp(float $n): string
    {
        return match (true) {
            $n >= 1e9 => 'Rp'.str_replace('.', ',', number_format($n / 1e9, 1, '.', '')).'M',
            $n >= 1e6 => 'Rp'.str_replace('.', ',', number_format($n / 1e6, 1, '.', '')).'Jt',
            default => 'Rp'.number_format($n, 0, ',', '.'),
        };
    }

    private static function idDate(?string $iso): string
    {
        if (! $iso) {
            return '—';
        }
        try {
            $d = new \DateTime($iso);
        } catch (\Exception) {
            return '—';
        }
        $mon = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

        return $d->format('j').' '.$mon[(int) $d->format('n') - 1].' '.$d->format('Y');
    }

    // Query scoping RBAC — port lib/scope.js: super tanpa filter, admin per
    // practiceId, psikolog per professionalId (+practiceId bila ada).
    private function scopedQuery(): array
    {
        $p = Session::get(PraktiquApi::PROFILE_KEY, []);
        $role = $p['role'] ?? 'admin';
        $params = [];
        if ($role === 'admin' && ! empty($p['practiceId'])) {
            $params['practiceId'] = $p['practiceId'];
        }
        if ($role === 'psikolog') {
            if (! empty($p['professionalId'])) {
                $params['professionalId'] = $p['professionalId'];
            }
            if (! empty($p['practiceId'])) {
                $params['practiceId'] = $p['practiceId'];
            }
        }

        return $params;
    }

    // ── Row mappers (port map* di DashboardApp.js) ─────────────────────

    private static function mapAppt(array $r): array
    {
        $status = strtolower((string) ($r['status'] ?? ''));

        return [
            'initial' => self::initialsOf(self::pick($r, ['clientName', 'client.name', 'name'])),
            'color' => self::color(),
            'name' => self::pick($r, ['clientName', 'client.name', 'name']) ?? '—',
            'doctor' => self::pick($r, ['professionalName', 'professional.fullName', 'doctorName']) ?? '—',
            'clinic' => self::pick($r, ['practiceName', 'practice.name', 'clinicName']) ?? '—',
            'date' => self::pick($r, ['date', 'appointmentDate']) ?? '—',
            'time' => isset($r['startTime']) ? $r['startTime'].' - '.($r['endTime'] ?? '') : ($r['time'] ?? '—'),
            'service' => self::pick($r, ['serviceName', 'service.name']) ?? '—',
            'charges' => isset($r['totalAmount']) ? self::rp((float) $r['totalAmount']) : ($r['charges'] ?? '—'),
            'payment' => self::pick($r, ['paymentMethod', 'payment']) ?? '—',
            'status' => $r['status'] ?? '—',
            'badge' => str_contains($status, 'book') ? 'green'
                : (str_contains($status, 'pending') ? 'salmon'
                : (str_contains($status, 'check') ? 'blue' : 'green')),
        ];
    }

    private static function mapPatient(array $r): array
    {
        $clinic = self::pick($r, ['practiceName', 'practice.name']);

        return [
            'initial' => self::initialsOf(self::pick($r, ['name', 'fullName'])),
            'name' => self::pick($r, ['name', 'fullName']) ?? '—',
            'email' => $r['email'] ?? '—',
            'clinic' => $clinic ?? '—',
            'clinicTag' => (bool) $clinic,
            'mobile' => self::pick($r, ['mobile', 'telephoneNo', 'phone']) ?? '—',
            'reg' => isset($r['createdAt']) ? self::idDate($r['createdAt']) : '—',
            'active' => ($r['status'] ?? null) !== 'inactive' && ($r['status'] ?? null) !== false,
            'color' => self::color(),
            'id' => $r['id'] ?? null,
        ];
    }

    private static function mapDoctor(array $r): array
    {
        return [
            'initial' => self::initialsOf(self::pick($r, ['fullName', 'name'])),
            'name' => self::pick($r, ['fullName', 'name']) ?? '—',
            'email' => $r['email'] ?? '—',
            'clinic' => self::pick($r, ['practiceName', 'practice.name']) ?? '—',
            'mobile' => self::pick($r, ['mobile', 'telephoneNo', 'phone']) ?? '—',
            'spec' => self::pick($r, ['professionalType', 'specialization']) ?? 'Psikolog',
            'active' => ($r['status'] ?? null) !== 'inactive' && ($r['status'] ?? null) !== false,
            'color' => self::color(),
            'id' => $r['id'] ?? null,
        ];
    }

    private static function mapBill(array $r): array
    {
        $status = strtolower((string) (self::pick($r, ['paymentStatus', 'status']) ?? ''));

        return [
            'id' => (string) ($r['id'] ?? ''),
            'initial' => self::initialsOf(self::pick($r, ['clientName', 'client.name', 'name'])),
            'name' => self::pick($r, ['clientName', 'client.name', 'name']) ?? '—',
            'doctor' => self::pick($r, ['professionalName', 'professional.fullName', 'doctorName']) ?? '—',
            'clinic' => self::pick($r, ['practiceName', 'practice.name']) ?? '—',
            'date' => isset($r['createdAt']) ? self::idDate($r['createdAt']) : ($r['date'] ?? '—'),
            'service' => self::pick($r, ['serviceName', 'service.name', 'description']) ?? '—',
            'discount' => isset($r['discount']) ? self::rp((float) $r['discount']) : 'Rp0',
            'total' => isset($r['totalAmount']) ? self::rp((float) $r['totalAmount']) : ($r['total'] ?? '—'),
            'status' => self::pick($r, ['paymentStatus', 'status']) ?? '—',
            'badge' => (str_contains($status, 'paid') || str_contains($status, 'lunas')) ? 'green' : 'salmon',
            'color' => self::color(),
        ];
    }

    private static function mapEncounter(array $r): array
    {
        $status = strtolower((string) ($r['status'] ?? ''));

        return [
            'initial' => self::initialsOf(self::pick($r, ['clientName', 'client.name', 'patientName'])),
            'color' => self::color(),
            'name' => self::pick($r, ['clientName', 'client.name', 'patientName']) ?? '—',
            'doctor' => self::pick($r, ['professionalName', 'professional.fullName', 'doctorName']) ?? '—',
            'clinic' => self::pick($r, ['practiceName', 'practice.name']) ?? '—',
            'date' => self::pick($r, ['date', 'encounterDate']) ?? '—',
            'time' => self::pick($r, ['time', 'startTime']) ?? '—',
            'type' => self::pick($r, ['type', 'encounterType', 'serviceName']) ?? '—',
            'note' => self::pick($r, ['notes', 'description']) ?? '',
            'status' => $r['status'] ?? '—',
            'badge' => (str_contains($status, 'selesai') || str_contains($status, 'completed')) ? 'green'
                : ((str_contains($status, 'berlangsung') || str_contains($status, 'ongoing')) ? 'blue' : 'salmon'),
        ];
    }

    private static function mapReceptionist(array $r): array
    {
        return [
            'initial' => self::initialsOf(self::pick($r, ['name', 'fullName'])),
            'name' => self::pick($r, ['name', 'fullName']) ?? '—',
            'email' => $r['email'] ?? '—',
            'clinic' => self::pick($r, ['practiceName', 'practice.name']) ?? '—',
            'mobile' => self::pick($r, ['mobile', 'telephoneNo', 'phone']) ?? '—',
            'active' => ($r['status'] ?? null) !== 'inactive' && ($r['status'] ?? null) !== false,
            'color' => self::color(),
            'id' => $r['id'] ?? null,
        ];
    }

    private static function mapClinic(array $r): array
    {
        return [
            'initial' => self::initialsOf($r['name'] ?? ''),
            'name' => $r['name'] ?? '—',
            'address' => $r['address'] ?? '—',
            'phone' => self::pick($r, ['telephoneNo', 'phone']) ?? '—',
            'ownerPhoto' => self::pick($r, ['ownerPhoto', 'ownerPhotoUrl', 'owner_photo']) ?? '',
            'doctors' => $r['totalProfessionals'] ?? (isset($r['professionals']) ? count($r['professionals']) : 0),
            'active' => ($r['status'] ?? null) !== 'inactive' && ($r['status'] ?? null) !== false,
            'color' => self::color(),
            'id' => $r['id'] ?? null,
            'slug' => BookingApi::slugify($r['name'] ?? '') ?: (string) ($r['id'] ?? ''),
        ];
    }

    // Tanpa nilai karangan: kapasitas/jam/hari yang tidak dikirim API tampil
    // kosong, bukan angka default yang seolah data asli.
    private static function mapSession(array $r): array
    {
        $booked = (int) (self::pick($r, ['bookedSlots', 'booked']) ?? 0);
        $capacity = (int) (self::pick($r, ['totalSlots', 'capacity']) ?? 0);

        return [
            'initial' => self::initialsOf(self::pick($r, ['professionalName', 'professional.fullName', 'doctorName'])),
            'name' => self::pick($r, ['professionalName', 'professional.fullName', 'doctorName']) ?? '—',
            'clinic' => self::pick($r, ['practiceName', 'practice.name']) ?? '—',
            'mode' => $r['mode'] ?? 'Online',
            'booked' => $booked,
            'capacity' => $capacity,
            'status' => ($capacity > 0 && $booked >= $capacity) ? 'full' : 'open',
            'hours' => (isset($r['startTime'], $r['endTime'])) ? $r['startTime'].' - '.$r['endTime'] : ($r['hours'] ?? '—'),
            'active' => self::pick($r, ['activeDays', 'days']) ?? [false, false, false, false, false, false, false],
            'color' => self::color(),
            'id' => $r['id'] ?? null,
        ];
    }

    private static function mapStats(mixed $raw): ?array
    {
        if (! is_array($raw)) {
            return null;
        }
        $out = [];
        $set = function (string $key, array $keys) use (&$out, $raw) {
            $v = self::pick($raw, $keys);
            if ($v !== null) {
                $out[$key] = (string) $v;
            }
        };
        $set('appointments', ['appointments', 'totalAppointments', 'appointment_count', 'sessions', 'totalSessions']);
        $set('patients', ['patients', 'totalPatients', 'clients', 'totalClients', 'patient_count']);
        $set('clinics', ['clinics', 'totalClinics', 'practices', 'totalPractices']);
        $set('doctors', ['doctors', 'totalDoctors', 'professionals', 'totalProfessionals']);
        $set('services', ['services', 'totalServices', 'service_count']);
        $rev = self::pick($raw, ['revenue', 'totalRevenue', 'revenue_amount', 'income']);
        if ($rev !== null) {
            $out['revenue'] = is_numeric($rev) ? self::compactRp((float) $rev) : (string) $rev;
        }

        return $out ?: null;
    }

    private static function mapRevenueChart(mixed $raw): ?array
    {
        $rows = collect(self::asArray($raw['chart'] ?? $raw['series'] ?? $raw))
            ->map(fn ($r) => [
                'label' => (string) (self::pick($r, ['label', 'month', 'name', 'x']) ?? '?'),
                'num' => (float) (self::pick($r, ['value', 'total', 'amount', 'revenue', 'y']) ?? 0),
            ])
            ->filter(fn ($r) => $r['label'] !== '?' || $r['num'] > 0)
            ->values();
        if ($rows->isEmpty()) {
            return null;
        }
        $max = max(1, $rows->max('num'));

        return $rows->map(fn ($r) => [
            'label' => $r['label'],
            'val' => self::compactRp($r['num']),
            'h' => (int) round($r['num'] / $max * 100),
        ])->all();
    }

    // Teruskan unggahan foto (modal Tambah Klinik) ke endpoint file-upload
    // backend. Respons UploadResult per-berkas: kegagalan dibaca dari
    // files[].error, bukan dari status HTTP saja (207 = sebagian gagal).
    public function upload(\Illuminate\Http\Request $request)
    {
        $request->validate(['file' => 'required|file|max:10240']);
        $file = $request->file('file');

        $res = \Illuminate\Support\Facades\Http::timeout(60)
            ->withToken(Session::get(PraktiquApi::TOKEN_KEY))
            ->attach('file', fopen($file->getRealPath(), 'r'), $file->getClientOriginalName())
            ->post(rtrim(config('praktiqu.base'), '/').'/api/v1/custom-fields/file-upload', [
                'context' => 'custom-field',
                'entityType' => $request->input('entityType', 'practice-owner'),
            ]);

        $json = $res->json();
        $rec = $json['files'][0] ?? $json['data']['files'][0] ?? null;
        if (! $res->successful() || ($rec['error'] ?? null)) {
            $msg = $rec['error'] ?? $json['message'] ?? $json['detail'] ?? $json['title'] ?? "HTTP {$res->status()}";

            return response()->json(['message' => $msg], 502);
        }

        return response()->json(['url' => $rec['url'] ?? $rec['fileUrl'] ?? $rec['path'] ?? '']);
    }

    // ── Page ───────────────────────────────────────────────────────────

    public function index(string $role)
    {
        $q = $this->scopedQuery();
        $list = fn (string $path) => fn () => self::asArray($this->api->get($path, $q));

        $results = $this->api->allSettled([
            'stats' => fn () => $this->api->get('api/v1/dashboard/statistics', $q),
            'revenue' => fn () => $this->api->get('api/v1/dashboard/revenue-chart', $q),
            'sessions' => $list('api/v1/sessions'),
            'clients' => $list('api/v1/clients'),
            'professionals' => $list('api/v1/professionals'),
            'bills' => $list('api/v1/bills'),
            'encounters' => $list('api/v1/encounters'),
            'receptionists' => $list('api/v1/receptionists'),
            'practices' => $list('api/v1/practices'),
            'doctorSessions' => $list('api/v1/doctor-sessions'),
            'clinicSchedules' => $list('api/v1/clinic-schedules'),
        ]);

        // Refresh gagal di tengah jalan (PraktiquApi sudah membersihkan sesi)
        // → jangan menatap dashboard yang gagal memuat; kembali ke login.
        if (! Session::has(PraktiquApi::TOKEN_KEY)) {
            return redirect('/');
        }

        $val = fn (string $k) => $results[$k]['ok'] ? $results[$k]['value'] : null;
        $rows = fn (string $k, callable $mapper) => array_map($mapper, $val($k) ?? []);

        $critical = ['sessions', 'clients', 'professionals', 'bills'];
        $allFailed = collect($critical)->every(fn ($k) => ! $results[$k]['ok']);

        $profile = Session::get(PraktiquApi::PROFILE_KEY, []);
        $roleName = ['super' => 'Super Admin', 'admin' => 'Admin Klinik', 'psikolog' => 'Psikolog'][$role] ?? 'Admin';

        return view('dashboard', [
            'role' => $role,
            'payload' => [
                'role' => $role,
                'profile' => [
                    'name' => $profile['name'] ?? $roleName,
                    'sub' => $roleName.' · PraktiQu',
                    'initial' => self::initialsOf($profile['name'] ?? $roleName),
                ],
                'dataError' => $allFailed
                    ? 'Tidak dapat terhubung ke server. Pastikan koneksi internet Anda dan coba lagi.'
                    : null,
                'stats' => self::mapStats($val('stats')),
                'revenue' => self::mapRevenueChart($val('revenue')) ?? [],
                'appts' => $rows('sessions', self::mapAppt(...)),
                'patients' => $rows('clients', self::mapPatient(...)),
                'doctors' => $rows('professionals', self::mapDoctor(...)),
                'billing' => $rows('bills', self::mapBill(...)),
                'encounters' => $rows('encounters', self::mapEncounter(...)),
                'receptionists' => $rows('receptionists', self::mapReceptionist(...)),
                'clinics' => $rows('practices', self::mapClinic(...)),
                'sessions' => $rows('doctorSessions', self::mapSession(...)),
            ],
        ]);
    }
}
