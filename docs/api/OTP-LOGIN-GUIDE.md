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

### Soal CORS — belum ada jawaban di repo ini

Karena dua origin ini beda, `fetch` dari browser ke `staging2.praktiqu.com` butuh header `Access-Control-Allow-Origin` (dan kawan-kawannya) dari API supaya browser mengizinkan responsnya dibaca oleh halaman di `terpadu.praktiqu.com`. Sudah dicek dengan grep menyeluruh untuk `Access-Control-`, `cors`, konfigurasi `headers()` di `next.config.js`, dan isi `src/middleware.ts` serta kedua route handler OTP — **tidak ada satu pun yang mengatur header CORS** di repo ini. `src/middleware.ts` hanya mengurus verifikasi JWT dan cookie sesi, bukan CORS.

Itu tidak berarti fetch-nya pasti gagal, dan juga tidak berarti pasti berhasil — kalau memang berjalan di staging, itu diatur oleh sesuatu di luar repo ini (reverse proxy atau gateway di depan `staging2.praktiqu.com`), bukan oleh kode Next.js-nya. **Konfirmasi ke tim backend dulu** sebelum membangun halaman ini di atas asumsi bahwa `fetch` lintas origin ke `staging2.praktiqu.com` akan berhasil.

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

`code` harus persis **6 digit angka** (regex `^\d{6}$` di server). Validasi bentuknya di klien sebelum mengirim — kalau usernya baru mengetik 4 digit atau menyelipkan spasi, jangan kirim ke server. Ini bukan soal menghemat kesempatan tebak: kode yang bentuknya salah ditolak oleh regex ini sebagai `validation_error` *sebelum* `verifyOtp` sempat dipanggil, jadi attempt counter di §5 tidak ikut tersentuh. Alasan validasi di klien murni menghindari round-trip ke server yang sudah pasti gagal — tetap berguna, hanya bukan karena "menyelamatkan" salah satu dari lima kesempatan.

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
| `400` | `invalid_code` | Kode salah, tidak ada kode aktif untuk email ini (belum pernah minta, sudah dipakai, atau sudah digantikan oleh kode yang lebih baru), atau emailnya tidak dikenal sistem | "Kode salah. Periksa lagi email kamu" |
| `400` | `code_expired` | **Digit yang dikirim benar**, tapi umur kodenya sudah lewat 10 menit | "Kode sudah kedaluwarsa. Minta kode baru" |
| `400` | `too_many_attempts` | **Digit yang dikirim benar**, tapi kode itu sudah ditebak salah 5 kali | "Terlalu banyak percobaan. Minta kode baru" |
| `403` | `account_inactive` | Kode benar, tapi akunnya dinonaktifkan | "Akun kamu tidak aktif. Hubungi klinik" |
| `429` | `rate_limited` | Terlalu banyak percobaan verify dari (IP, email) ini; ada header `Retry-After` (detik) | "Terlalu sering. Coba lagi dalam beberapa menit" |

> **Kenapa `code_expired` dan `too_many_attempts` hanya muncul kalau digitnya benar.** Kalau
> server memberitahu "kode ini sudah kedaluwarsa" kepada siapa pun yang asal menebak, itu sama
> saja mengaku bahwa email tersebut **terdaftar** — penyerang tinggal minta kode untuk alamat
> mana pun, menunggu 10 menit, lalu menebak asal. Karena itu tebakan yang salah selalu dijawab
> `invalid_code`, apa pun keadaan kodenya. Bagi user yang sah tidak ada bedanya: dia mengetik
> digit yang benar, jadi tetap mendapat pesan yang tepat.
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
| `invalid_code` | Belum tentu — bisa masih hidup, bisa juga sudah mati | Biarkan user mengetik ulang kode di form yang sama |
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

Validasi bentuk di klien sebelum mengirim — bukan supaya tidak memakan kesempatan tebak (kode berbentuk salah ditolak sebagai `validation_error` sebelum sempat dihitung sebagai attempt, lihat §3), tapi supaya user tidak menunggu satu round-trip ke server untuk kesalahan yang sudah jelas dari bentuknya saja:

| Aturan | Pemeriksaan |
|---|---|
| Persis 6 karakter | `code.length === 6` |
| Semua digit angka | `/^\d{6}$/.test(code)` |

Pertimbangkan input 6 kotak terpisah (satu digit per kotak) seperti pola OTP pada umumnya — itu murni pilihan UX, backend hanya peduli hasil akhirnya berupa string 6 digit.

Server tetap memvalidasi ulang (`validation_error` kalau lolos dari klien tapi salah bentuk), jadi jangan hilangkan penanganan errornya di klien hanya karena sudah ada mask input.

---

## 7. Catatan penting

**Pengiriman email di staging sudah terverifikasi jalan.** `RESEND_API_KEY` sudah terpasang di environment staging, dan pengiriman kode sudah dites langsung sampai ke inbox — bukan cuma tercatat di log. Tidak perlu fallback baca log server untuk mengetes alur ini di staging.

**Jangan tampilkan cooldown sebagai error.** Kalau user menekan "kirim ulang" sebelum `retryAfter` habis, endpoint `request` tetap membalas `200` yang sama seperti biasa, dengan `retryAfter: 60` yang sama seperti di luar cooldown — bukan `429`, dan bukan sisa waktu yang berkurang. Server tidak pernah mengembalikan sisa cooldown yang sebenarnya: kalau dia melakukannya, dua panggilan berjarak satu detik akan membocorkan apakah alamat itu terdaftar (terdaftar → angkanya turun 59, 58, ...; tidak terdaftar → selalu 60). UI-lah yang bertanggung jawab menonaktifkan tombolnya sendiri selama hitungan mundur lokalnya; jangan menunggu server menolak, dan jangan mengharapkan `retryAfter` mengecil pada percobaan kedua.

---

## 8. Contoh implementasi

Bagian ini kode yang bisa langsung disalin. Intinya sengaja ditulis sebagai TypeScript polos —
front-end kalian berdiri di origin sendiri dan belum tentu Next.js, jadi hanya contoh komponen
terakhir yang React.

### 8.1 Klien API

Dua fungsi, plus satu pembaca error. Semua error dari API ini berbentuk `problem+json`, dan yang
kalian butuhkan dari situ selalu field `code` — bukan `detail`, yang teksnya bisa berubah
sewaktu-waktu dan berbahasa Inggris.

```ts
// otpApi.ts
const API = 'https://staging2.praktiqu.com';

export type OtpErrorCode =
  | 'invalid_body'
  | 'validation_error'
  | 'invalid_code'
  | 'code_expired'
  | 'too_many_attempts'
  | 'account_inactive'
  | 'rate_limited'
  | 'internal_error';

export class OtpError extends Error {
  constructor(
    readonly code: OtpErrorCode,
    /** Detik sampai boleh mencoba lagi. Hanya terisi untuk `rate_limited`. */
    readonly retryAfter?: number,
  ) {
    super(code);
  }
}

async function toError(res: Response): Promise<OtpError> {
  const body = await res.json().catch(() => ({}));
  const retryAfter = Number(res.headers.get('Retry-After')) || undefined;
  return new OtpError((body.code as OtpErrorCode) ?? 'internal_error', retryAfter);
}

/** Minta kode dikirim. Balasannya sama untuk email terdaftar maupun tidak. */
export async function requestOtp(email: string): Promise<{ retryAfter: number }> {
  const res = await fetch(`${API}/api/v1/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw await toError(res);
  return res.json();
}

export interface Session {
  user: {
    id: string;
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    displayName: string;
    role: 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'PROFESSIONAL' | 'RECEPTIONIST' | 'CLIENT';
    wpUserId: number | null;
  };
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export async function verifyOtp(email: string, code: string): Promise<Session> {
  const res = await fetch(`${API}/api/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  if (!res.ok) throw await toError(res);
  return res.json();
}
```

Perhatikan `verifyOtp` tidak memakai `credentials: 'include'`. Sesi tidak dititipkan lewat cookie
lintas-origin — token dikembalikan di body response dan front-end yang menyimpannya sendiri.

### 8.2 Menyimpan sesi

Response `verify` bentuknya sama persis dengan `POST /api/v1/auth/login`, jadi pakai fungsi
penyimpan yang sama untuk kedua alur. Jangan menulis dua jalur berbeda — di aplikasi Next lama,
menyalin pola ini dengan nama field yang salah pernah membuat cookie berisi `undefined` dan
tidak ada yang menyadarinya sampai lama.

```ts
export function saveSession(s: Session) {
  localStorage.setItem('accessToken', s.accessToken);
  localStorage.setItem('refreshToken', s.refreshToken);
  localStorage.setItem('accessTokenExpiresAt', s.accessTokenExpiresAt);
  localStorage.setItem('user', JSON.stringify(s.user));
}
```

Setelah tersimpan, arahkan user ke tujuan yang sama dengan login password. Kalau ada `returnTo`
di query string, hormati itu; kalau tidak, ke halaman utama setelah login.

### 8.3 Hitung mundur yang selamat dari reload

Server **tidak pernah** memberi tahu sisa cooldown yang sebenarnya (§7) — dia selalu menjawab
`retryAfter: 60`. Jadi hitungan mundurnya murni milik klien, dan kalau hanya disimpan di state
React, me-refresh halaman akan mengaktifkan kembali tombol "kirim ulang" padahal server masih
menolak diam-diam. Simpan waktu kedaluwarsanya, bukan sisa detiknya.

```ts
const KEY = 'otpResendAt';

export function startCooldown(seconds: number) {
  localStorage.setItem(KEY, String(Date.now() + seconds * 1000));
}

/** Sisa detik, 0 kalau sudah boleh kirim ulang. */
export function cooldownLeft(): number {
  const until = Number(localStorage.getItem(KEY) ?? 0);
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}
```

```ts
// hook kecil untuk menampilkan angkanya
function useCooldown() {
  const [left, setLeft] = useState(cooldownLeft);
  useEffect(() => {
    const t = setInterval(() => setLeft(cooldownLeft()), 1000);
    return () => clearInterval(t);
  }, []);
  return left;
}
```

### 8.4 Mesin state kedua layar

```
LAYAR 1 — minta kode
  idle ──(submit email)──> sending
  sending ──(200)────────> pindah ke LAYAR 2, startCooldown(retryAfter)
  sending ──(validation_error)──> idle + pesan "Masukkan email yang valid"
  sending ──(rate_limited)─────> idle + form dikunci selama Retry-After detik

LAYAR 2 — masukkan kode
  idle ──(submit 6 digit)──> verifying
  verifying ──(200)────────> saveSession(), redirect
  verifying ──(invalid_code)──────> idle, biarkan user mengetik ulang di form yang sama
  verifying ──(code_expired)──────> mati, tampilkan tombol "Minta kode baru"
  verifying ──(too_many_attempts)─> mati, tampilkan tombol "Minta kode baru"
  verifying ──(account_inactive)──> buntu, arahkan ke kontak klinik, JANGAN tawarkan resend
  verifying ──(rate_limited)──────> kunci form selama Retry-After detik

  tombol "kirim ulang" aktif hanya saat cooldownLeft() === 0
```

Yang membedakan `invalid_code` dari dua saudaranya: hanya `invalid_code` yang menyisakan
kemungkinan kodenya masih hidup. Untuk `code_expired` dan `too_many_attempts`, tombol "coba lagi"
yang mengirim ulang `verify` yang sama akan **selalu** gagal — satu-satunya jalan maju adalah kode
baru. Lihat §4.

### 8.5 Contoh komponen layar kode (React)

```tsx
function OtpVerifyScreen({ email }: { email: string }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<OtpErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const cooldown = useCooldown();

  const codeIsDead = error === 'code_expired' || error === 'too_many_attempts';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError('validation_error');
    setBusy(true);
    setError(null);
    try {
      saveSession(await verifyOtp(email, code));
      redirectAfterLogin();
    } catch (err) {
      setError(err instanceof OtpError ? err.code : 'internal_error');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    const { retryAfter } = await requestOtp(email);
    startCooldown(retryAfter);
    setCode('');
    setError(null);
  }

  return (
    <form onSubmit={submit}>
      <p>Kami mengirim kode 6 angka ke {email}.</p>

      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        disabled={busy || codeIsDead}
      />

      {error && <p role="alert">{PESAN[error]}</p>}

      {!codeIsDead && (
        <button type="submit" disabled={busy || code.length !== 6}>
          {busy ? 'Memeriksa…' : 'Masuk'}
        </button>
      )}

      {error !== 'account_inactive' && (
        <button type="button" onClick={resend} disabled={cooldown > 0}>
          {cooldown > 0 ? `Kirim ulang dalam ${cooldown}s` : 'Minta kode baru'}
        </button>
      )}
    </form>
  );
}
```

`autoComplete="one-time-code"` membuat iOS dan Android menawarkan kodenya langsung dari notifikasi
SMS/email — dan itu sebabnya kodenya diletakkan di baris subjek email, supaya terbaca tanpa
membuka isinya.

Peta pesannya memakai teks yang sama dengan tabel di §3:

```ts
const PESAN: Record<OtpErrorCode, string> = {
  invalid_body: 'Terjadi kesalahan. Coba lagi.',
  validation_error: 'Masukkan email yang valid dan kode 6 angka',
  invalid_code: 'Kode salah. Periksa lagi email kamu',
  code_expired: 'Kode sudah kedaluwarsa. Minta kode baru',
  too_many_attempts: 'Terlalu banyak percobaan. Minta kode baru',
  account_inactive: 'Akun kamu tidak aktif. Hubungi klinik',
  rate_limited: 'Terlalu sering. Coba lagi dalam beberapa menit',
  internal_error: 'Terjadi kesalahan di server. Coba lagi sebentar lagi',
};
```

### 8.6 Yang paling gampang keliru

Empat hal ini sudah pernah menjadi bug nyata di proyek ini atau ditemukan saat review:

1. **Menampilkan "email tidak terdaftar".** Endpoint `request` tidak pernah memberi tahu itu, dan
   memang sengaja. UI yang menebak-nebak sendiri justru membocorkan hal yang susah payah ditutup
   di server.
2. **Mengharapkan `retryAfter` mengecil.** Nilainya selalu 60. Hitung mundur adalah tanggung jawab
   klien.
3. **Menyimpan sisa detik, bukan waktu kedaluwarsa.** Refresh halaman akan mengembalikan tombol
   resend terlalu cepat.
4. **Menawarkan "kirim ulang" pada `account_inactive`.** Yang bermasalah akunnya, bukan kodenya —
   kode baru tidak akan menolong dan kode lamanya pun sudah terbakar.

---

## 9. Referensi

- Endpoint: [`src/app/api/v1/auth/otp/request/route.ts`](../../src/app/api/v1/auth/otp/request/route.ts), [`src/app/api/v1/auth/otp/verify/route.ts`](../../src/app/api/v1/auth/otp/verify/route.ts)
- Logika bisnis: [`src/services/auth/otp.service.ts`](../../src/services/auth/otp.service.ts)
- Konstanta kebijakan (panjang kode, TTL, batas percobaan, cooldown): [`src/lib/auth/otp.ts`](../../src/lib/auth/otp.ts)
- Desain: [`docs/superpowers/specs/2026-08-18-otp-email-login-design.md`](../superpowers/specs/2026-08-18-otp-email-login-design.md)
- Pola halaman yang bisa dicontek: [`src/app/login/page.tsx`](../../src/app/login/page.tsx) — styling dan penanganan error yang sama bisa dipakai ulang untuk halaman OTP.
