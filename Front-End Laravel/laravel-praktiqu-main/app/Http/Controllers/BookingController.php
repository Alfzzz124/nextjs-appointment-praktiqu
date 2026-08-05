<?php

namespace App\Http\Controllers;

use App\Services\ApiException;
use App\Services\BookingApi;
use Illuminate\Http\Request;

// Halaman booking publik per tenant + endpoint AJAX-nya. Halaman selalu
// dirender dengan data API terbaru (tanpa cache) supaya perubahan layanan/
// harga di backend langsung terlihat.
class BookingController extends Controller
{
    public function __construct(private readonly BookingApi $booking)
    {
    }

    // Ubah galat backend (sering berbahasa Inggris mentah seperti "Internal
    // Server Error") jadi pesan Indonesia yang ramah, dipetakan dari status
    // HTTP-nya supaya tetak konsisten apa pun teks aslinya.
    private function friendly(ApiException $e, string $default): string
    {
        return match (true) {
            in_array($e->status, [400, 401, 422], true) => 'Token booking tidak valid atau sudah kedaluwarsa. Silakan ulangi pemesanan.',
            $e->status === 404 => 'Data pembayaran tidak ditemukan.',
            $e->status === 429 => 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.',
            $e->status === 0 || $e->status >= 500 => 'Server sedang bermasalah. Coba beberapa saat lagi.',
            default => $default,
        };
    }

    public function show(string $tenant)
    {
        $t = $this->booking->resolveTenant($tenant);
        abort_unless($t, 404);

        // URL kanonik berbasis nama klinik: kalau diakses lewat id numerik atau
        // slug lain (mis. /4), alihkan ke /nama-klinik supaya address bar rapi
        // dan konsisten. Alihkan hanya kalau berbeda (hindari loop).
        if (! empty($t['canonicalSlug']) && $tenant !== $t['canonicalSlug']) {
            return redirect('/'.$t['canonicalSlug']);
        }

        // Ingat tenant terakhir supaya kalau browser mendarat via GET di route
        // pembayaran (mis. redirect balik dari gateway), kita bisa mengarahkan
        // kembali ke halaman booking-nya.
        session(['pq_last_tenant' => $tenant]);

        return view('booking', ['tenant' => $t, 'adminFee' => config('praktiqu.admin_fee')]);
    }

    // Route pembayaran/verifikasi hanya menerima POST (dipanggil via fetch).
    // Kalau ada GET yang nyasar ke sini (navigasi/redirect gateway), jangan
    // 405 — arahkan balik ke halaman booking tenant terakhir. init() di sana
    // memulihkan token dari sessionStorage lalu menampilkan status pembayaran.
    public function paymentReturn()
    {
        $slug = session('pq_last_tenant');

        return redirect($slug ? '/'.$slug : '/');
    }

    public function slots(Request $request)
    {
        $data = $request->validate([
            'professionalId' => 'required|string',
            'date' => 'required|date_format:Y-m-d',
        ]);

        return response()->json($this->booking->fetchSlots($data['professionalId'], $data['date']));
    }

    public function submit(Request $request)
    {
        $data = $request->validate([
            'professionalId' => 'required|string',
            'serviceId' => 'required|string',
            'date' => 'required|date_format:Y-m-d',
            'startTime' => 'required|string',
            'clientName' => 'required|string',
            'clientEmail' => 'required|email',
            'clientMobile' => 'required|string',
            'notes' => 'nullable|string|max:1000',
        ]);

        $slot = [
            'professionalId' => $data['professionalId'],
            'serviceId' => $data['serviceId'],
            'date' => $data['date'],
            'startTime' => $data['startTime'],
        ];
        $client = array_filter([
            'clientName' => $data['clientName'],
            'clientEmail' => $data['clientEmail'],
            'clientMobile' => $data['clientMobile'],
            'notes' => $data['notes'] ?? null,
        ]);

        try {
            return response()->json($this->booking->submitBooking($slot, $client));
        } catch (ApiException $e) {
            return response()->json(['message' => $this->friendly($e, 'Booking gagal. Silakan coba lagi.')], 502);
        }
    }

    public function pay(Request $request)
    {
        $data = $request->validate(['token' => 'required|string']);

        try {
            return response()->json($this->booking->startPayment($data['token']));
        } catch (ApiException $e) {
            return response()->json(['message' => $this->friendly($e, 'Gagal membuka halaman pembayaran.')], 502);
        }
    }

    public function verify(Request $request)
    {
        $data = $request->validate(['token' => 'required|string']);

        return response()->json($this->booking->checkPayment($data['token']));
    }
}
