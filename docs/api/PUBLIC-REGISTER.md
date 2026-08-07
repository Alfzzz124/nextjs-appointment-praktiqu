# Registrasi Mandiri Pasien — `POST /api/v1/public/auth/register`

Endpoint publik untuk pasien mendaftarkan akunnya sendiri. Tanpa token, dan hasilnya pasien langsung masuk — tidak perlu memanggil `login` lagi.

> Diverifikasi langsung ke `staging2.praktiqu.com` pada 2026-08-07: register `201`, login dengan akun itu `200`, register ulang `409`, password lemah `400`, email ngawur `400`.

Kode: [`src/app/api/v1/public/auth/register/route.ts`](../../src/app/api/v1/public/auth/register/route.ts) → [`register()`](../../src/services/auth/service.ts) → [`createPatient()`](../../src/repositories/wp/patients.write.ts).
Desainnya: [`docs/superpowers/specs/2026-08-06-public-self-registration-design.md`](../superpowers/specs/2026-08-06-public-self-registration-design.md).

---

## 1. Jangan tertukar dengan `/api/v1/auth/register`

Ada dua endpoint bernama `register` dan keduanya bukan hal yang sama.

| | `/api/v1/public/auth/register` | `/api/v1/auth/register` |
|---|---|---|
| Akses | Publik, tanpa token | Butuh Bearer token, **hanya `SUPER_ADMIN`** |
| Untuk siapa | Pasien mendaftar sendiri | Admin membuatkan akun staf |
| Role yang dibuat | Selalu `CLIENT` | Bebas, dari enum `UserRole` |
| Akun WordPress | **Dibuat**, dengan hash password asli | **Tidak dibuat** |
| Bisa login setelahnya | Ya | **Tidak**, sampai akun WP-nya dibuat manual dan di-link lewat `wpUserId` |
| Response | `201` + token | `201` + `{ id, email, role }` |

Kalau yang kamu mau adalah pendaftaran dari sisi pengguna, selalu yang **`/public/`**.

---

## 2. Request

```
POST /api/v1/public/auth/register
Content-Type: application/json
```

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `email` | string | ✅ | Harus format email valid. Dinormalisasi ke huruf kecil dan di-trim. |
| `password` | string | ✅ | Minimal 8 karakter, **harus mengandung huruf dan angka**. |
| `firstName` | string | ✅ | Minimal 1 karakter. |
| `lastName` | string | ✅ | Minimal 1 karakter. |
| `contactNumber` | string | ➖ | Nomor HP. Kalau dikirim, masuk ke `basic_data.mobile_number` di WordPress. |

Tidak ada field `username` — server menurunkannya dari email, dan WordPress yang menjamin keunikannya. Tidak ada field klinik juga; lihat §6.

---

## 3. Response sukses — `201`

Bentuknya **sama persis dengan `POST /api/v1/auth/login`**, ditambah `userId`. Jadi front-end bisa menyimpan sesi dengan kode yang sama untuk kedua alur.

```json
{
  "userId": "cmsib6kf20000xh1x3694y524",
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
  "accessTokenExpiresAt": "2026-08-07T02:26:28.000Z",
  "refreshToken": "DoUevdteq7IPufwoV05S7l46js3b...",
  "refreshTokenExpiresAt": "2026-08-14T02:11:28.900Z"
}
```

`wpUserId` dikirim sebagai **angka biasa**, bukan string — di database dia `BigInt`, dan route yang mengubahnya supaya `JSON.stringify` tidak error.

---

## 4. Response gagal

Semua error memakai format `application/problem+json`.

| HTTP | `code` | Kapan terjadi |
|---|---|---|
| `400` | `invalid_body` | Body bukan JSON yang valid |
| `400` | `validation_error` | Field wajib kosong atau format email salah |
| `400` | `weak_password` | Kurang dari 8 karakter, atau tidak ada huruf/angka |
| `409` | `duplicate_email` | Email sudah terdaftar |
| `429` | `rate_limited` | Kena rate limit; ada header `Retry-After` (detik) |
| `503` | `service_unavailable` | WordPress tidak bisa dihubungi |

Contoh:

```json
{
  "type": "https://staging2.praktiqu.com/problems/conflict",
  "title": "Conflict",
  "status": 409,
  "code": "duplicate_email",
  "detail": "That email is already registered — please sign in",
  "instance": "/api/v1/public/auth/register"
}
```

**Soal `409`:** pesannya sengaja seragam. Kalau email itu ternyata milik dokter atau admin, jawabannya tetap "sudah terdaftar" — siapa pemilik akunnya bukan urusan orang yang belum login.

---

## 5. Rate limit

Dihitung per pasangan **(IP, email)** dengan jendela geser 15 menit:

| Ambang | Efek |
|---|---|
| 5 kegagalan | Penundaan progresif 30 detik |
| 10 kegagalan | Terkunci 5 menit, balas `429` + `Retry-After` |

Pendaftaran yang berhasil me-reset hitungannya. Tidak ada CAPTCHA — rate limit ini satu-satunya pengaman dari penyalahgunaan.

---

## 6. Apa yang terjadi di WordPress

Urutannya: **WordPress dulu, baru database aplikasi.** Kalau WordPress gagal, tidak ada baris setengah jadi yang tertinggal.

1. Panggil `POST /wp-json/praktiqu/v1/patients` di plugin `praktiqu-endpoint`.
2. Plugin menjalankan `wp_insert_user` — jadi passwordnya **di-hash sungguhan oleh WordPress**, bukan placeholder. Ini yang membuat akunnya benar-benar bisa login.
3. Plugin memicu `kc_patient_save`, sehingga pembukuan KiviCare dan custom field Pro tetap jalan.
4. Role WordPress-nya `kiviCare_patient`.
5. Baru kemudian baris `users` dibuat di database aplikasi, ditautkan lewat `wpUserId`.

**Tidak ada mapping klinik saat mendaftar.** Pasien baru tidak terikat ke klinik mana pun sampai dia melakukan booking pertama — saat itu `resolvePatient()` di alur public booking yang memetakannya. Konsekuensinya: pasien yang sudah mendaftar tapi belum pernah booking **tidak muncul di daftar pasien klinik mana pun**. Itu perilaku yang disengaja, bukan bug.

---

## 7. ⚠️ Password terkirim plaintext di email welcome

Hook `kc_patient_save` memicu email selamat datang KiviCare, dan email itu memuat password yang dipilih pasien **dalam teks polos** (`KCPatientNotificationListener::sendPatientWelcomeNotification`).

Ini **risiko yang diterima secara sadar**, tercatat di dokumen desain. Kalau mau ditutup tanpa mengubah kode: nonaktifkan template email `patient_register` di pengaturan KiviCare.

---

## 8. Contoh pemakaian

### curl

```bash
curl -sS -X POST https://staging2.praktiqu.com/api/v1/public/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "budi@example.com",
    "password": "rahasia123",
    "firstName": "Budi",
    "lastName": "Santoso",
    "contactNumber": "081234567890"
  }'
```

> Dari luar server, WAF kadang menjawab dengan halaman cek-bot alih-alih JSON. Kalau balasannya HTML, jalankan dari dalam server atau lewat browser.

### Ambil token untuk request berikutnya

```bash
TOKEN=$(curl -sS -X POST https://staging2.praktiqu.com/api/v1/public/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"budi@example.com","password":"rahasia123","firstName":"Budi","lastName":"Santoso"}' \
  | jq -r '.accessToken')

curl -sS https://staging2.praktiqu.com/api/v1/auth/me -H "Authorization: Bearer $TOKEN"
```

### Front-end

Halaman [`/register`](../../src/app/register/page.tsx) sudah memakai endpoint ini. Setelah `201` dia menyimpan cookie `access_token` dan `refresh_token` lalu mengarahkan ke `/dashboard`.

Perhatikan penamaan field saat menyalin pola ini: API mengembalikan **`accessToken`** / **`refreshToken`** (camelCase), sementara cookie yang dibaca middleware bernama `access_token` / `refresh_token` (snake_case). Salah baca di sini pernah membuat halaman login menyimpan cookie berisi `undefined`.

---

## 9. Batasan yang belum dikerjakan

- Tidak ada verifikasi email / double opt-in. Akun langsung aktif.
- Tidak ada CAPTCHA.
- Hanya role `CLIENT`. Tidak ada jalur publik untuk mendaftar sebagai dokter atau staf.
- Endpoint ini **belum ada di `openapi.yaml`**. Bukan karena generatornya belum dijalankan: [`scripts/generate-openapi.ts`](../../scripts/generate-openapi.ts) hanya "memiliki" sebagian grup route, dan grup `auth`/`public` masih dipelihara manual — makanya `npm run openapi:check` tetap lolos meski endpoint ini tidak tercatat di sana. Dokumen ini yang jadi acuan sampai grup itu didaftarkan ke generator.
