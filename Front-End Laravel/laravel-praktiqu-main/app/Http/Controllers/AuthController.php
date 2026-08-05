<?php

namespace App\Http\Controllers;

use App\Services\ApiException;
use App\Services\PraktiquApi;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Session;

// Auth staf terhadap /api/v1/auth/* — port dari lib/auth.js FE lama.
// Login divalidasi backend sungguhan (akun WordPress asli); tidak ada
// fallback mode demo.
class AuthController extends Controller
{
    public const ROLE_DEST = ['super' => '/admin', 'admin' => '/klinik', 'psikolog' => '/psikolog'];

    public function __construct(private readonly PraktiquApi $api)
    {
    }

    public function showLogin(Request $request)
    {
        // Sudah login → langsung ke area sesuai role, jangan tampilkan form.
        $profile = Session::get(PraktiquApi::PROFILE_KEY);
        if (Session::has(PraktiquApi::TOKEN_KEY) && $profile) {
            return redirect(self::ROLE_DEST[$profile['role']] ?? '/psikolog');
        }

        return view('login');
    }

    // Normalisasi penamaan role backend ke tiga role FE.
    private function roleOf(?array $user): string
    {
        $raw = strtolower((string) ($user['role'] ?? ($user['roles'][0] ?? '')));

        return match (true) {
            str_contains($raw, 'super') => 'super',
            str_contains($raw, 'admin'), str_contains($raw, 'receptionist') => 'admin',
            str_contains($raw, 'psiko'), str_contains($raw, 'doctor'), str_contains($raw, 'professional') => 'psikolog',
            default => 'admin',
        };
    }

    private function extractPracticeId(?array $u): mixed
    {
        return $u['practiceId'] ?? $u['practice_id'] ?? $u['practice']['id'] ?? $u['clinic']['id'] ?? null;
    }

    private function extractProfessionalId(?array $u): mixed
    {
        return $u['professionalId'] ?? $u['professional_id'] ?? $u['professional']['id'] ?? $u['doctorId'] ?? $u['doctor_id'] ?? null;
    }

    public function login(Request $request)
    {
        $cred = $request->validate([
            'email' => 'required|email',
            'password' => 'required|string',
        ], [
            'email.required' => 'Masukkan email yang valid, mis. nama@email.com',
            'email.email' => 'Masukkan email yang valid, mis. nama@email.com',
            'password.required' => 'Masukkan kata sandi Anda',
        ]);

        try {
            $res = $this->api->post('api/v1/auth/login', $cred);
        } catch (ApiException $e) {
            // 4xx = kredensial ditolak; 429 = rate limit backend; 5xx = backend
            // bermasalah (jangan tampilkan pesan mentah bhs Inggris dari server).
            $msg = match (true) {
                in_array($e->status, [400, 401, 422]) => 'Email atau kata sandi salah.',
                $e->status === 429 => 'Terlalu banyak percobaan login. Tunggu ±30 detik, lalu coba lagi.',
                $e->status >= 500 => 'Server sedang bermasalah. Coba beberapa saat lagi atau hubungi admin.',
                default => $e->getMessage() ?: 'Gagal masuk. Coba lagi.',
            };

            return back()->withErrors(['login' => $msg])->withInput($request->only('email'));
        }

        $token = $res['token'] ?? $res['accessToken'] ?? $res['access_token']
            ?? $res['data']['token'] ?? $res['data']['accessToken'] ?? null;
        // refreshToken wajib disimpan: accessToken berumur pendek dan
        // PraktiquApi memakainya untuk memperbarui sesi diam-diam saat 401.
        $refresh = $res['refreshToken'] ?? $res['refresh_token']
            ?? $res['data']['refreshToken'] ?? $res['data']['refresh_token'] ?? null;
        $user = $res['user'] ?? $res['data']['user'] ?? $res['data'] ?? $res;
        $user = is_array($user) ? $user : [];
        $role = $this->roleOf($user);

        $request->session()->regenerate();
        Session::put(PraktiquApi::TOKEN_KEY, $token);
        Session::put(PraktiquApi::REFRESH_KEY, $refresh);

        $profile = [
            'role' => $role,
            'name' => $user['name'] ?? $user['fullName'] ?? null,
            'email' => $user['email'] ?? $cred['email'],
            'userId' => $user['id'] ?? $user['userId'] ?? null,
            'practiceId' => $this->extractPracticeId($user),
            'professionalId' => $this->extractProfessionalId($user),
        ];

        // Lengkapi profil dari /auth/me kalau bisa (data login sering minim).
        if ($token) {
            try {
                $me = $this->api->get('api/v1/auth/me');
                $meUser = $me['user'] ?? $me['data']['user'] ?? $me['data'] ?? $me;
                if (is_array($meUser)) {
                    $profile = [
                        'role' => $this->roleOf($meUser) ?: $role,
                        'name' => $meUser['name'] ?? $meUser['fullName'] ?? $profile['name'],
                        'email' => $meUser['email'] ?? $profile['email'],
                        'userId' => $meUser['id'] ?? $meUser['userId'] ?? $profile['userId'],
                        'practiceId' => $this->extractPracticeId($meUser) ?? $profile['practiceId'],
                        'professionalId' => $this->extractProfessionalId($meUser) ?? $profile['professionalId'],
                    ];
                }
            } catch (ApiException $e) {
                logger()->warning('[auth] /auth/me gagal setelah login: '.$e->getMessage());
            }
        }

        Session::put(PraktiquApi::PROFILE_KEY, $profile);

        return redirect(self::ROLE_DEST[$profile['role']] ?? '/psikolog');
    }

    public function logout(Request $request)
    {
        if (Session::has(PraktiquApi::TOKEN_KEY)) {
            try {
                $this->api->post('api/v1/auth/logout', []);
            } catch (ApiException $e) {
                logger()->warning('[auth] logout server gagal (sesi tetap dihapus lokal): '.$e->getMessage());
            }
        }
        $this->api->clearSession();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect('/');
    }
}
