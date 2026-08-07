# Pedoman Halaman Lupa Password — untuk Tim Front-End

Dua halaman yang perlu dibuat, dan dua endpoint yang sudah siap dipakai. Dokumen ini berisi kontrak lengkap keduanya beserta perilaku yang wajib diikuti UI.

Backend-nya sudah selesai dan lolos test. Yang belum ada hanya halamannya.

---

## 1. Gambaran alur

```
Halaman /forgot-password
   user isi email
   → POST /api/v1/auth/forgot-password
   → selalu 200: "kalau emailnya terdaftar, link sudah dikirim"

Email masuk, isinya link:
   https://<app>/reset-password?token=<TOKEN>

Halaman /reset-password
   baca ?token= dari URL
   user isi password baru + konfirmasi
   → POST /api/v1/auth/reset-password  { token, password }
   → 200 → arahkan ke /login dengan pesan sukses
```

Kedua endpoint **publik** — jangan kirim header `Authorization`.

Token berlaku **30 menit** dan **sekali pakai**.

---

## 2. Halaman `/forgot-password`

### Request

```http
POST /api/v1/auth/forgot-password
Content-Type: application/json

{ "email": "budi@example.com" }
```

### Response

| Status | Isi | Arti |
|---|---|---|
| `200` | `{ "message": "If that email exists, a reset link has been sent." }` | Selesai — tampilkan pesan netral |
| `400` | `code: "validation_error"` | Format email tidak valid |
| `400` | `code: "invalid_body"` | Body bukan JSON valid |
| `429` | `code: "rate_limited"` | Terlalu sering; ada header `Retry-After` (detik) |

### ⚠️ Aturan yang wajib dipatuhi UI

**Balasan `200` tidak berarti emailnya terdaftar.** Endpoint sengaja menjawab sama persis untuk email yang ada maupun tidak — supaya orang tidak bisa memakai form ini untuk menebak-nebak siapa saja yang punya akun.

Jadi UI **tidak boleh** menampilkan "Email tidak ditemukan" atau semacamnya. Pesan yang benar kira-kira:

> Kalau email itu terdaftar, kami sudah mengirimkan link untuk mengatur ulang password. Silakan cek kotak masuk kamu, termasuk folder spam.

Tampilkan pesan yang sama apa pun hasilnya.

### Rate limit

Dihitung per pasangan **(IP, email)** dalam jendela 15 menit: 5 kegagalan memicu penundaan, 10 kegagalan mengunci 5 menit. Saat terkunci, balasannya `429` — tampilkan pesan agar user menunggu, pakai nilai `Retry-After` kalau mau menghitung mundur.

---

## 3. Halaman `/reset-password`

### Mengambil token

Token ada di query string: `/reset-password?token=abc123...`. Ambil apa adanya, jangan di-`decodeURIComponent` manual — API browser (`useSearchParams`, `URLSearchParams`) sudah melakukannya.

Kalau `token` tidak ada di URL, jangan tampilkan formnya. Langsung tampilkan pesan bahwa link-nya tidak valid, plus tautan ke `/forgot-password`.

### Request

```http
POST /api/v1/auth/reset-password
Content-Type: application/json

{ "token": "abc123...", "password": "rahasia123" }
```

Tidak perlu mengirim email — token yang menentukan siapa usernya.

### Response sukses

```json
{ "message": "Password updated. Please sign in." }
```

**Tidak ada token yang dikembalikan.** User tidak otomatis masuk. Arahkan ke `/login`, misalnya `/login?reset=1`, dan tampilkan pesan sukses di sana.

Ini disengaja: siapa pun yang memegang link email seharusnya tidak langsung mendapat sesi aktif.

### Response gagal

| Status | `code` | Saran pesan untuk user |
|---|---|---|
| `400` | `validation_error` | "Token dan password baru harus diisi." |
| `400` | `weak_password` | Pakai `detail` dari response — isinya sudah menjelaskan aturannya |
| `400` | `invalid_token` | "Link ini tidak valid. Silakan minta link baru." |
| `400` | `token_expired` | "Link ini sudah kedaluwarsa. Silakan minta link baru." |
| `400` | `token_used` | "Link ini sudah pernah dipakai. Silakan minta link baru." |
| `429` | `rate_limited` | "Terlalu banyak percobaan. Coba lagi beberapa saat." |
| `503` | `service_unavailable` | "Layanan sedang bermasalah. Coba lagi sebentar lagi." |

Untuk ketiga error token (`invalid_token`, `token_expired`, `token_used`), **sediakan tombol menuju `/forgot-password`**. Itu satu-satunya jalan keluar bagi user, dan ketiganya sengaja dibedakan supaya pesannya bisa tepat.

Khusus `503`: passwordnya **belum berubah** dan **tokennya masih berlaku**. Jadi user boleh mencoba lagi dengan link yang sama — jangan suruh dia minta link baru.

### Bentuk error

Semua error memakai `application/problem+json`:

```json
{
  "type": "https://staging2.praktiqu.com/problems/bad-request",
  "title": "Bad Request",
  "status": 400,
  "code": "token_expired",
  "detail": "Reset link has expired — please request a new one",
  "instance": "/api/v1/auth/reset-password"
}
```

Baca `code` untuk menentukan cabang logika. `detail` berbahasa Inggris — untuk `weak_password` boleh ditampilkan langsung, sisanya sebaiknya pakai pesan Indonesia dari tabel di atas.

---

## 4. Validasi password di sisi klien

Validasi di klien supaya user tidak bolak-balik ke server. Aturannya sama persis dengan yang dipakai backend:

| Aturan | Pemeriksaan |
|---|---|
| Minimal 8 karakter | `password.length >= 8` |
| Mengandung huruf | `/[A-Za-z]/.test(password)` |
| Mengandung angka | `/\d/.test(password)` |

Tambahkan juga field "Konfirmasi Password" dan pastikan keduanya sama — itu murni urusan front-end, backend tidak memeriksanya.

Backend tetap memvalidasi ulang, jadi tetap tangani `weak_password` walaupun sudah dicek di klien.

---

## 5. Catatan penting

**Email belum benar-benar terkirim di staging.** `RESEND_API_KEY` belum dipasang di environment staging, jadi `sendEmail` hanya mencetak isi email ke log server. Untuk mengetes alurnya, ambil token dari log server, atau minta backend memasang kunci Resend lebih dulu.

**Satu link membatalkan link sebelumnya.** Setiap kali `forgot-password` dipanggil, token lama milik user itu langsung dibatalkan. Kalau user menekan tombol kirim dua kali, hanya email terakhir yang link-nya berfungsi — link dari email pertama akan menghasilkan `token_used`. Pertimbangkan menonaktifkan tombolnya sesaat setelah diklik.

**Reset mengusir semua sesi.** Setelah password berhasil diubah, seluruh refresh token milik user dicabut. Perangkat lain yang sedang login akan terlempar keluar saat token akses mereka habis. Itu memang tujuannya.

---

## 6. Referensi

- Endpoint: [`src/app/api/v1/auth/forgot-password/route.ts`](../../src/app/api/v1/auth/forgot-password/route.ts), [`src/app/api/v1/auth/reset-password/route.ts`](../../src/app/api/v1/auth/reset-password/route.ts)
- Desain: [`docs/superpowers/specs/2026-08-07-password-reset-design.md`](../superpowers/specs/2026-08-07-password-reset-design.md)
- Pola halaman yang bisa dicontek: [`src/app/login/page.tsx`](../../src/app/login/page.tsx) dan [`src/app/register/page.tsx`](../../src/app/register/page.tsx) — keduanya sudah memakai styling dan penanganan error yang sama.
