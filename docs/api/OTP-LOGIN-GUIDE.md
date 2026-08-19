# Pedoman Login dengan Kode OTP — untuk Tim Front-End

Satu halaman baru yang perlu dibuat, dan dua endpoint yang sudah siap dipakai: minta kode, lalu tukar kode dengan sesi. Dokumen ini berisi kontrak lengkap keduanya beserta perilaku yang wajib diikuti UI.

Backend-nya sudah selesai dan lolos test. Yang belum ada hanya halamannya.

Kode: [`src/app/api/v1/auth/otp/request/route.ts`](../../src/app/api/v1/auth/otp/request/route.ts), [`src/app/api/v1/auth/otp/verify/route.ts`](../../src/app/api/v1/auth/otp/verify/route.ts) → [`otp.service.ts`](../../src/services/auth/otp.service.ts) → [`otp.ts`](../../src/lib/auth/otp.ts).
Desainnya: [`docs/superpowers/specs/2026-08-18-otp-email-login-design.md`](../superpowers/specs/2026-08-18-otp-email-login-design.md).

---

## 0. Base URL — API dan halaman **bukan host yang sama**

Kedua endpoint dipanggil ke API:

```
https://staging2.praktiqu.com/api/v1/auth/otp/request
https://staging2.praktiqu.com/api/v1/auth/otp/verify
```

Halaman front-end-nya sendiri **tidak** ada di `staging2.praktiqu.com` — aplikasi user sekarang tinggal di `https://terpadu.praktiqu.com`. Jadi ini dua origin yang terpisah: halaman `/login-otp` (atau apa pun namanya) di-serve dari `terpadu.praktiqu.com`, tapi `fetch`-nya menembak ke `staging2.praktiqu.com`. Jangan asumsikan endpoint ini hidup di host yang sama dengan halamannya sendiri.

---

## 1. Gambaran alur

```
Halaman login OTP
   user isi email
   → POST /api/v1/auth/otp/request
   → selalu 200: "kalau emailnya terdaftar, kode sudah dikirim"
   → tombol "kirim ulang" nonaktif selama `retryAfter` detik

Email masuk, isinya kode 6 angka. Berlaku 10 menit.

Halaman yang sama (atau langkah berikutnya)
   user isi kode 6 angka
   → POST /api/v1/auth/otp/verify  { email, code }
   → 200 → simpan token, masuk ke aplikasi (sama seperti login password)
```

Kedua endpoint **publik** — jangan kirim header `Authorization`.

Kode berlaku **10 menit** dan mati setelah **5 kali salah tebak**.

---

## 2. `POST /api/v1/auth/otp/request` — minta kode

### Request

```http
POST /api/v1/auth/otp/request
Content-Type: application/json

{ "email": "budi@example.com" }
```

### Response sukses — selalu `200`

```json
{ "message": "If that email exists, a code has been sent.", "retryAfter": 60 }
```

`retryAfter` **bukan** informasi tambahan yang boleh diabaikan — itu jumlah detik tombol "kirim ulang kode" harus tetap nonaktif di UI. Nilainya sekarang selalu `60`, tapi jangan hardcode 60 di klien: pakai angka yang dikembalikan server, karena nilai itulah yang benar-benar dipakai server untuk menahan pengiriman berikutnya.

### ⚠️ Endpoint ini SELALU menjawab 200 — kecuali body-nya rusak atau kena rate limit

Selain dua error di bawah, **tidak ada balasan lain**. Endpoint ini sengaja tidak membedakan email yang terdaftar dari yang tidak — bahkan cooldown-nya pun sama persis untuk keduanya. Ini bukan detail kecil; ini aturan keamanan inti dari fitur ini.

Konsekuensinya untuk UI:

- **Tidak boleh ada state "email tidak ditemukan".** Tidak ada, dalam bentuk apa pun — toast, teks di bawah field, apa pun.
- Tampilkan pesan netral yang sama persis apa pun hasilnya, misalnya:

  > Kalau email itu terdaftar, kami sudah mengirimkan kode ke email kamu. Silakan cek kotak masuk, termasuk folder spam.

- Perlakukan `200` sebagai satu-satunya jalur sukses menuju layar "masukkan kode", tidak peduli apakah email itu benar-benar ada di sistem.

### Response gagal

| Status | `code` | Kapan terjadi |
|---|---|---|
| `400` | `invalid_body` | Body bukan JSON valid |
| `400` | `validation_error` | Format email tidak valid |
| `429` | `rate_limited` | Terlalu sering kirim; ada header `Retry-After` (detik) |

Pesan Indonesia yang disarankan ada di tabel gabungan §4.

### Rate limit

Dihitung per pasangan **(IP, email)**, jendela 15 menit: **5 kali kirim** (dihitung dari setiap percobaan kirim, bukan cuma yang berhasil mengirim mail) langsung mengunci pasangan itu selama **15 menit**. Tidak ada jeda progresif di endpoint ini — begitu tembus 5, langsung `429`.

Ini berarti mengetuk tombol "kirim ulang" berkali-kali di luar cooldown `retryAfter` tetap bisa mengunci user dari kodenya sendiri. Jangan buat tombol resend yang bisa diklik berulang-ulang secepatnya — hormati `retryAfter` dari response sukses, dan kalau sampai kena `429`, hormati juga `Retry-After` dari header-nya.

---

## 3. `POST /api/v1/auth/otp/verify` — tukar kode dengan sesi

### Request

```http
POST /api/v1/auth/otp/verify
Content-Type: application/json

{ "email": "budi@example.com", "code": "482913" }
```

`code` harus persis **6 digit angka** (regex `^\d{6}$` di server). Validasi bentuknya di klien sebelum mengirim — kalau usernya baru mengetik 4 digit atau menyelipkan spasi, jangan kirim ke server. Setiap kirim ke server yang salah tetap memakan satu dari lima kesempatan tebak kode itu (lihat §5), jadi input mask 6 digit di klien bukan hiasan.

### Response sukses — `200`

Bentuknya **sama persis dengan `POST /api/v1/auth/login`**:

```json
{
  "user": {
    "id": "cmsib6kf20000xh1x3694y524",
    "email": "budi@example.com",
    "username": "budi",
    "firstName": "Budi",
    "lastName": "Santoso",
    "displayName": "Budi Santoso",
    "role": "CLIENT",
    "wpUserId": 924
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "accessTokenExpiresAt": "2026-08-18T02:26:28.000Z",
  "refreshToken": "DoUevdteq7IPufwoV05S7l46js3b...",
  "refreshTokenExpiresAt": "2026-08-25T02:11:28.900Z"
}
```

`wpUserId` dikirim sebagai **angka biasa**, bukan string — di database dia `BigInt`, dan route yang mengubahnya supaya `JSON.stringify` tidak error.

### ⚠️ Jebakan penamaan field — copas dari kasus yang sudah pernah terjadi

API mengembalikan **`accessToken`** / **`refreshToken`** (camelCase), sementara cookie yang dibaca middleware bernama **`access_token`** / **`refresh_token`** (snake_case). Salah baca di sini pernah membuat halaman login menyimpan cookie berisi `undefined`. Kalau menyalin pola penyimpanan sesi dari halaman `/login` atau `/register`, cek dulu penamaan field di kedua sisi.

### Response gagal

Semua error memakai format `application/problem+json`.

| Status | `code` | Kapan terjadi | Pesan untuk user |
|---|---|---|---|
| `400` | `invalid_body` | Body bukan JSON valid | *(tidak seharusnya user lihat — kesalahan klien)* |
| `400` | `validation_error` | Email tidak valid, atau `code` bukan 6 digit angka | "Masukkan email yang valid dan kode 6 angka" |
| `400` | `invalid_code` | Kode salah, sudah kedaluwarsa dan belum diperbarui, sudah dipakai, atau emailnya tidak dikenal | "Kode salah. Periksa lagi email kamu" |
| `400` | `code_expired` | Kode ada tapi umurnya sudah lewat 10 menit | "Kode sudah kedaluwarsa. Minta kode baru" |
| `400` | `too_many_attempts` | Kode itu sudah ditebak salah 5 kali | "Terlalu banyak percobaan. Minta kode baru" |
| `403` | `account_inactive` | Kode benar, tapi akunnya dinonaktifkan | "Akun kamu tidak aktif. Hubungi klinik" |
| `429` | `rate_limited` | Terlalu banyak percobaan verify dari (IP, email) ini; ada header `Retry-After` (detik) | "Terlalu sering. Coba lagi dalam beberapa menit" |
| `500` | `internal_error` | Error tak terduga di server | *(pesan generik, minta user coba lagi)* |

Contoh bentuk error:

```json
{
  "type": "https://staging2.praktiqu.com/problems/bad-request",
  "title": "Bad Request",
  "status": 400,
  "code": "code_expired",
  "detail": "That code has expired — request a new one",
  "instance": "/api/v1/auth/otp/verify"
}
```

Baca `code` untuk menentukan cabang logika di UI, bukan `detail` — `detail` berbahasa Inggris dan sekadar penjelasan untuk log/debug. Tampilkan pesan Indonesia dari tabel di atas ke user.

**Catatan soal `invalid_code`:** kode ini juga yang dipakai saat emailnya tidak dikenal sistem sama sekali. Itu sengaja — sama seperti `request` yang tidak boleh membocorkan siapa yang terdaftar, `verify` juga tidak boleh membedakan "email tidak ada" dari "kodenya salah". Jangan buat cabang UI terpisah untuk itu.

---

## 4. Kapan menawarkan "minta kode baru" vs sekadar minta user mengetik ulang

Ini bagian yang paling gampang salah desain, jadi dipisah sendiri.

| `code` | Kode itu masih bisa dipakai? | Yang harus ditawarkan UI |
|---|---|---|
| `validation_error` | Belum sempat dicek — bentuknya saja salah | Biarkan user membetulkan input, jangan panggil server lagi |
| `invalid_code` | Masih hidup (kalau memang ada) | Biarkan user mengetik ulang kode di form yang sama |
| `code_expired` | **Tidak** — sudah mati | Tombol/link **"Minta kode baru"** yang memanggil `request` lagi, bukan tombol "coba lagi" biasa |
| `too_many_attempts` | **Tidak** — sudah terbakar meski dites lagi | Sama seperti di atas: **"Minta kode baru"** |
| `account_inactive` | Sudah terpakai (lihat §5) | **Bukan** "minta kode baru" — akunnya yang bermasalah, bukan kodenya. Arahkan ke kontak klinik, jangan tampilkan tombol resend di sini |
| `rate_limited` | Tergantung state di server | Nonaktifkan form sampai `Retry-After` detik berlalu |

Singkatnya: `code_expired` dan `too_many_attempts` berarti kodenya sudah tidak berguna sama sekali — satu-satunya jalan maju adalah kode baru. Sebuah tombol "coba lagi" yang cuma mengirim ulang request `verify` yang sama akan selalu gagal lagi untuk keduanya.

---

## 5. Detail perilaku yang mempengaruhi desain UI

- **Kode 6 digit, berlaku 10 menit, mati setelah 5 kali salah.** Ketiga angka ini konstanta di server (`OTP_LENGTH`, `OTP_TTL_MS`, `OTP_MAX_ATTEMPTS` di `src/lib/auth/otp.ts`); pesan di email juga menyebut "expires in 10 minutes".
- **Minta kode baru membatalkan kode lama.** Begitu `request` berhasil mengirim kode baru, kode-kode lama milik user itu langsung ditandai terpakai. Kalau usernya menekan "kirim ulang" lalu memakai kode dari email pertama, hasilnya `invalid_code`.
- **Kode ditebak salah menghabiskan attempt-nya walau emailnya beda.** Attempt dihitung per kode (per baris di database), bukan per (IP, email) — jadi ini benar-benar soal "kode ini sudah ditebak salah berapa kali", terpisah dari rate limit di bawah.
- **Ada rate limit kedua, di atas batas 5-attempt per kode.** Batas 5 kali di atas mengunci *satu kode*. Selain itu endpoint `verify` juga dibatasi per (IP, email) dengan jendela 15 menit: 5 kegagalan → jeda progresif, 10 kegagalan → kunci 5 menit (`429`). Ini menghalangi orang yang mencoba banyak kode berbeda secara berurutan, bukan cuma menebak-nebak satu kode. UI tidak perlu membedakan sumber `429`-nya — cukup ikuti `Retry-After`.
- **Kode yang benar tetap "terbakar" (`usedAt`) walau login akhirnya ditolak.** Urutan di server: cocokkan kode → tandai kode itu terpakai → baru cek status akun. Jadi kalau hasilnya `account_inactive`, kode yang barusan diketik user sudah tidak bisa dipakai lagi meski akunnya nanti diaktifkan kembali — user perlu memulai dari `request` lagi setelah akunnya aktif, bukan mencoba memakai kode yang sama.
- **Verifikasi email otomatis.** Kalau akun user belum pernah verifikasi email, berhasil membaca kode dari inbox itu sendiri dianggap sebagai bukti pemilik mailbox — server menandai email terverifikasi begitu `verify` sukses. Tidak ada langkah tambahan yang perlu dibuat UI untuk ini.

---

## 6. Validasi input kode di sisi klien

Validasi bentuk di klien sebelum mengirim, supaya kesalahan ketik tidak memakan satu dari lima kesempatan tebak yang sungguhan:

| Aturan | Pemeriksaan |
|---|---|
| Persis 6 karakter | `code.length === 6` |
| Semua digit angka | `/^\d{6}$/.test(code)` |

Pertimbangkan input 6 kotak terpisah (satu digit per kotak) seperti pola OTP pada umumnya — itu murni pilihan UX, backend hanya peduli hasil akhirnya berupa string 6 digit.

Server tetap memvalidasi ulang (`validation_error` kalau lolos dari klien tapi salah bentuk), jadi jangan hilangkan penanganan errornya di klien hanya karena sudah ada mask input.

---

## 7. Catatan penting

**Email belum tentu benar-benar sampai di staging** — cek dengan tim backend apakah `RESEND_API_KEY` sudah terpasang di environment staging saat ini. Kalau belum, `sendEmail` mencetak isi kode ke log server, dan itu satu-satunya cara mengetes alurnya dari sana.

**Jangan tampilkan cooldown sebagai error.** Kalau user menekan "kirim ulang" sebelum `retryAfter` habis, endpoint `request` tetap membalas `200` yang sama seperti biasa (dengan `retryAfter` baru yang sudah dikurangi waktu yang berlalu) — bukan `429`. UI-lah yang bertanggung jawab menonaktifkan tombolnya sendiri selama hitungan mundur; jangan menunggu server menolak.

---

## 8. Referensi

- Endpoint: [`src/app/api/v1/auth/otp/request/route.ts`](../../src/app/api/v1/auth/otp/request/route.ts), [`src/app/api/v1/auth/otp/verify/route.ts`](../../src/app/api/v1/auth/otp/verify/route.ts)
- Logika bisnis: [`src/services/auth/otp.service.ts`](../../src/services/auth/otp.service.ts)
- Konstanta kebijakan (panjang kode, TTL, batas percobaan, cooldown): [`src/lib/auth/otp.ts`](../../src/lib/auth/otp.ts)
- Desain: [`docs/superpowers/specs/2026-08-18-otp-email-login-design.md`](../superpowers/specs/2026-08-18-otp-email-login-design.md)
- Pola halaman yang bisa dicontek: [`src/app/login/page.tsx`](../../src/app/login/page.tsx) — styling dan penanganan error yang sama bisa dipakai ulang untuk halaman OTP.
