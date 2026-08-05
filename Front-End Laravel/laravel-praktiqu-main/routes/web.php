<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\BookingController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\ResourceController;
use Illuminate\Support\Facades\Route;

// Login staf (halaman awal) — pasien tidak punya akun.
Route::get('/', [AuthController::class, 'showLogin'])->name('login');
Route::post('/login', [AuthController::class, 'login']);
Route::post('/logout', [AuthController::class, 'logout'])->name('logout');

// Area dashboard per role — padanan app/{admin,klinik,psikolog} FE lama.
Route::get('/admin', fn () => app(DashboardController::class)->index('super'))->middleware('staff:super');
Route::get('/klinik', fn () => app(DashboardController::class)->index('admin'))->middleware('staff:admin');
Route::get('/psikolog', fn () => app(DashboardController::class)->index('psikolog'))->middleware('staff:psikolog');

// Aksi dashboard yang menulis ke backend /api/v1 asli (butuh sesi staf).
Route::middleware('staff:any')->group(function () {
    Route::post('/dashboard/upload', [DashboardController::class, 'upload']);
    Route::post('/dashboard/{resource}/create', [ResourceController::class, 'create']);
    Route::delete('/dashboard/{resource}/{id}', [ResourceController::class, 'destroy']);
    Route::patch('/dashboard/{resource}/{id}/status', [ResourceController::class, 'status']);
});

// AJAX booking publik (dipanggil dari halaman /{tenant}; server yang
// meneruskan ke backend, jadi bebas CORS).
Route::prefix('booking')->group(function () {
    Route::get('/slots', [BookingController::class, 'slots']);
    Route::post('/submit', [BookingController::class, 'submit']);
    Route::post('/pay', [BookingController::class, 'pay']);
    Route::post('/verify', [BookingController::class, 'verify']);
    // GET nyasar ke route pembayaran → jangan 405, arahkan balik ke booking.
    Route::get('/pay', [BookingController::class, 'paymentReturn']);
    Route::get('/verify', [BookingController::class, 'paymentReturn']);
});

// Halaman booking publik per tenant — paling akhir supaya tidak menelan
// route statis di atas.
Route::get('/{tenant}', [BookingController::class, 'show'])
    ->where('tenant', '^(?!admin$|klinik$|psikolog$|login$|logout$|booking$|up$)[a-z0-9-]+$');
