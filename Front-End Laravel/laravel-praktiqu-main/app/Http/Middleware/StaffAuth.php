<?php

namespace App\Http\Middleware;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Session;

// Gerbang area staf per role — padanan components/AuthGuard.js FE lama.
// Ini UX, bukan batas keamanan: perlindungan sebenarnya tetap backend yang
// membalas 401 untuk setiap panggilan /api/v1 tanpa token.
class StaffAuth
{
    public function handle(Request $request, Closure $next, string $role)
    {
        if (! Session::has(PraktiquApi::TOKEN_KEY)) {
            // Aksi AJAX (write) butuh 401 JSON, bukan redirect HTML.
            return $request->expectsJson()
                ? response()->json(['ok' => false, 'message' => 'Sesi berakhir. Silakan masuk lagi.'], 401)
                : redirect('/');
        }

        // "any" = cukup ada sesi (dipakai route aksi write); selain itu paksa
        // kecocokan role, tapi hanya kalau backend memang memberi role —
        // profil tanpa role dibiarkan lewat (default backend menentukan datanya).
        if ($role !== 'any') {
            $stored = Session::get(PraktiquApi::PROFILE_KEY.'.role');
            if ($stored && $stored !== $role) {
                return redirect(AuthController::ROLE_DEST[$stored] ?? '/');
            }
        }

        return $next($request);
    }
}
